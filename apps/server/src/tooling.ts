import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolAvailability } from './types';

export type ToolCommandConfig = {
  ffmpegCommand: string;
  ffprobeCommand: string;
  ytDlpCommand: string;
};

export type ServerToolName = 'ffmpeg' | 'yt-dlp';
export type ServerToolUpdateToolStatus = 'success' | 'failed' | 'unsupported';
export type ServerToolUpdateStatus = 'success' | 'partial' | 'failed' | 'unsupported';

export type ServerToolUpdateAttempt = {
  tool: ServerToolName;
  attempted: boolean;
  status: ServerToolUpdateToolStatus;
  strategy: string;
  command: string | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  message: string;
};

export type ServerToolUpdateResult = {
  ok: boolean;
  status: ServerToolUpdateStatus;
  platform: NodeJS.Platform;
  startedAt: string;
  finishedAt: string;
  tools: ServerToolUpdateAttempt[];
  summary: string;
};

type SyncCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
};

type CapturedCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
};

type UpdateCommandSpec = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
};

type ToolUpdatePlan =
  | {
      supported: true;
      tool: ServerToolName;
      strategy: string;
      successMessage: string;
      failureMessage: string;
      commands: UpdateCommandSpec[];
    }
  | {
      supported: false;
      tool: ServerToolName;
      strategy: string;
      message: string;
    };

const COMMAND_DETECTION_TIMEOUT_MS = 15_000;
const TOOL_UPDATE_COMMAND_TIMEOUT_MS = 10 * 60_000;
const CAPTURED_OUTPUT_LIMIT = 8_000;

function trimCapturedOutput(value: string): string {
  if (value.length <= CAPTURED_OUTPUT_LIMIT) {
    return value;
  }

  const sectionLength = Math.floor((CAPTURED_OUTPUT_LIMIT - 34) / 2);
  return `${value.slice(0, sectionLength)}\n...[captured output truncated]...\n${value.slice(-sectionLength)}`;
}

function appendCapturedOutput(currentValue: string, nextValue: string): string {
  return trimCapturedOutput(`${currentValue}${nextValue}`);
}

function runSyncCommand(command: string, args: string[] = []): SyncCommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: COMMAND_DETECTION_TIMEOUT_MS,
    env: process.env
  });

  return {
    exitCode: typeof result.status === 'number' ? result.status : -1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    errorMessage: result.error instanceof Error ? result.error.message : null
  };
}

function hasExecutable(command: string, args: string[] = ['-version']): boolean {
  const result = spawnSync(command, args, {
    stdio: 'ignore',
    timeout: COMMAND_DETECTION_TIMEOUT_MS,
    env: process.env
  });

  return result.status === 0;
}

function isCommandAvailable(command: string, args: string[] = ['--version']): boolean {
  const result = spawnSync(command, args, {
    stdio: 'ignore',
    timeout: COMMAND_DETECTION_TIMEOUT_MS,
    env: process.env
  });

  return result.status === 0;
}

function isPathLikeCommand(command: string): boolean {
  return command.includes('/') || command.includes('\\') || path.isAbsolute(command);
}

function safeRealpath(targetPath: string): string | null {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return null;
  }
}

function resolveExecutablePath(command: string): string | null {
  if (isPathLikeCommand(command)) {
    return fs.existsSync(command) ? safeRealpath(command) ?? command : null;
  }

  const whichResult = runSyncCommand('which', [command]);
  if (whichResult.exitCode !== 0) {
    return null;
  }

  const firstPath = whichResult.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry !== '');

  if (!firstPath) {
    return null;
  }

  return safeRealpath(firstPath) ?? firstPath;
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const normalizedParent = path.resolve(parentPath);
  const normalizedChild = path.resolve(childPath);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

function isHomebrewPackageInstalled(packageName: string): boolean {
  if (!isCommandAvailable('brew', ['--version'])) {
    return false;
  }

  const result = runSyncCommand('brew', ['list', '--versions', packageName]);
  return result.exitCode === 0 && result.stdout.trim() !== '';
}

function getHomebrewPackagePrefix(packageName: string): string | null {
  const result = runSyncCommand('brew', ['--prefix', packageName]);
  if (result.exitCode !== 0) {
    return null;
  }

  const prefix = result.stdout.trim().split(/\r?\n/)[0] ?? '';
  if (prefix === '') {
    return null;
  }

  return safeRealpath(prefix) ?? prefix;
}

function isHomebrewManagedExecutable(packageName: string, command: string): boolean {
  if (!isHomebrewPackageInstalled(packageName)) {
    return false;
  }

  const executablePath = resolveExecutablePath(command);
  const packagePrefix = getHomebrewPackagePrefix(packageName);
  if (!executablePath || !packagePrefix) {
    return false;
  }

  return isPathInside(packagePrefix, executablePath);
}

function isDpkgPackageInstalled(packageName: string): boolean {
  if (!isCommandAvailable('dpkg-query', ['--version'])) {
    return false;
  }

  const result = runSyncCommand('dpkg-query', ['-W', '-f=${Status}', packageName]);
  return result.exitCode === 0 && result.stdout.trim() === 'install ok installed';
}

function isDpkgManagedExecutable(packageName: string, command: string): boolean {
  if (!isDpkgPackageInstalled(packageName)) {
    return false;
  }

  const executablePath = resolveExecutablePath(command);
  if (!executablePath) {
    return false;
  }

  const result = runSyncCommand('dpkg-query', ['-S', executablePath]);
  if (result.exitCode !== 0) {
    return false;
  }

  return result.stdout
    .split(/\r?\n/)
    .some((line) => line === `${packageName}: ${executablePath}` || line.startsWith(`${packageName}:`));
}

function canRunAptGetSafely(): boolean {
  return isCommandAvailable('apt-get', ['--version']) && typeof process.getuid === 'function' && process.getuid() === 0;
}

function createHomebrewUpdatePlan(
  tool: ServerToolName,
  packageName: string,
  command: string,
  successMessage: string
): ToolUpdatePlan | null {
  if (!isHomebrewManagedExecutable(packageName, command)) {
    return null;
  }

  return {
    supported: true,
    tool,
    strategy: 'homebrew',
    successMessage,
    failureMessage: `${tool} Homebrew update failed.`,
    commands: [
      {
        command: 'brew',
        args: ['upgrade', packageName]
      }
    ]
  };
}

function createAptUpdatePlan(
  tool: ServerToolName,
  packageName: string,
  command: string,
  successMessage: string
): ToolUpdatePlan | null {
  if (!isDpkgManagedExecutable(packageName, command)) {
    return null;
  }

  if (!canRunAptGetSafely()) {
    return {
      supported: false,
      tool,
      strategy: 'apt',
      message: `${tool} appears to be managed by apt, but automatic apt updates require the server process to run as root. The update was not attempted.`
    };
  }

  const aptEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DEBIAN_FRONTEND: 'noninteractive'
  };

  return {
    supported: true,
    tool,
    strategy: 'apt',
    successMessage,
    failureMessage: `${tool} apt update failed.`,
    commands: [
      {
        command: 'apt-get',
        args: ['update'],
        env: aptEnv
      },
      {
        command: 'apt-get',
        args: ['install', '--only-upgrade', '-y', packageName],
        env: aptEnv
      }
    ]
  };
}

function readExecutableFirstLine(command: string): string | null {
  const executablePath = resolveExecutablePath(command);
  if (!executablePath) {
    return null;
  }

  try {
    const file = fs.openSync(executablePath, 'r');
    try {
      const buffer = Buffer.alloc(4096);
      const bytesRead = fs.readSync(file, buffer, 0, buffer.length, 0);
      const text = buffer.subarray(0, bytesRead).toString('utf8');
      const newlineIndex = text.indexOf('\n');
      return (newlineIndex === -1 ? text : text.slice(0, newlineIndex)).trim();
    } finally {
      fs.closeSync(file);
    }
  } catch {
    return null;
  }
}

function parseShebangCommand(firstLine: string | null): string | null {
  if (!firstLine?.startsWith('#!')) {
    return null;
  }

  const parts = firstLine.slice(2).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  const command = parts[0];
  if (path.basename(command) === 'env') {
    for (let index = 1; index < parts.length; index += 1) {
      const candidate = parts[index];
      if (candidate === '-S') {
        continue;
      }
      if (candidate.startsWith('-')) {
        continue;
      }
      return candidate;
    }
    return null;
  }

  return command;
}

function isLikelyUserLocalExecutable(executablePath: string): boolean {
  return executablePath.includes(`${path.sep}.local${path.sep}bin${path.sep}`);
}

function isLikelySameVirtualEnvExecutable(executablePath: string, pythonCommand: string): boolean {
  const pythonPath = resolveExecutablePath(pythonCommand);
  if (!pythonPath) {
    return false;
  }

  const executableDirectory = path.dirname(executablePath);
  const pythonDirectory = path.dirname(pythonPath);
  const systemPythonDirectories = new Set(['/bin', '/usr/bin', '/usr/local/bin']);

  return executableDirectory === pythonDirectory && !systemPythonDirectories.has(pythonDirectory);
}

function createPipManagedYtDlpPlan(command: string): ToolUpdatePlan | null {
  const executablePath = resolveExecutablePath(command);
  if (!executablePath) {
    return null;
  }

  const firstLine = readExecutableFirstLine(command);
  const shebangCommand = parseShebangCommand(firstLine);
  if (!shebangCommand || !path.basename(shebangCommand).includes('python')) {
    return null;
  }

  if (!isCommandAvailable(shebangCommand, ['-m', 'pip', '--version'])) {
    return null;
  }

  if (isLikelyUserLocalExecutable(executablePath)) {
    return {
      supported: true,
      tool: 'yt-dlp',
      strategy: 'pip-user',
      successMessage: 'yt-dlp user-level pip package update completed.',
      failureMessage: 'yt-dlp user-level pip package update failed.',
      commands: [
        {
          command: shebangCommand,
          args: ['-m', 'pip', 'install', '--user', '--upgrade', 'yt-dlp']
        }
      ]
    };
  }

  if (isLikelySameVirtualEnvExecutable(executablePath, shebangCommand)) {
    return {
      supported: true,
      tool: 'yt-dlp',
      strategy: 'pip-virtualenv',
      successMessage: 'yt-dlp virtual environment package update completed.',
      failureMessage: 'yt-dlp virtual environment package update failed.',
      commands: [
        {
          command: shebangCommand,
          args: ['-m', 'pip', 'install', '--upgrade', 'yt-dlp']
        }
      ]
    };
  }

  return null;
}

function isPipxManagedYtDlp(command: string): boolean {
  if (!isCommandAvailable('pipx', ['--version'])) {
    return false;
  }

  const executablePath = resolveExecutablePath(command);
  if (!executablePath) {
    return false;
  }

  if (!executablePath.includes(`${path.sep}pipx${path.sep}venvs${path.sep}yt-dlp${path.sep}`)) {
    return false;
  }

  const result = runSyncCommand('pipx', ['list', '--short']);
  if (result.exitCode !== 0) {
    return false;
  }

  return result.stdout
    .split(/\r?\n/)
    .some((line) => line.trim().split(/\s+/)[0] === 'yt-dlp');
}

function createPipxYtDlpPlan(command: string): ToolUpdatePlan | null {
  if (!isPipxManagedYtDlp(command)) {
    return null;
  }

  return {
    supported: true,
    tool: 'yt-dlp',
    strategy: 'pipx',
    successMessage: 'yt-dlp pipx package update completed.',
    failureMessage: 'yt-dlp pipx package update failed.',
    commands: [
      {
        command: 'pipx',
        args: ['upgrade', 'yt-dlp']
      }
    ]
  };
}

function createYtDlpSelfUpdatePlan(command: string): ToolUpdatePlan | null {
  if (!hasExecutable(command, ['--version'])) {
    return null;
  }

  return {
    supported: true,
    tool: 'yt-dlp',
    strategy: 'self-update',
    successMessage: 'yt-dlp self-update completed.',
    failureMessage: 'yt-dlp self-update failed. This usually means the executable is managed by an unsupported installer or is not writable by the server process.',
    commands: [
      {
        command,
        args: ['-U']
      }
    ]
  };
}

function createFfmpegUpdatePlan(commands: ToolCommandConfig): ToolUpdatePlan {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return {
      supported: false,
      tool: 'ffmpeg',
      strategy: 'unsupported-platform',
      message: `Automatic ffmpeg updates are not supported on ${process.platform}.`
    };
  }

  const homebrewPlan = createHomebrewUpdatePlan(
    'ffmpeg',
    'ffmpeg',
    commands.ffmpegCommand,
    'ffmpeg Homebrew package update completed. ffprobe is updated with the same package when Homebrew provides it.'
  );
  if (homebrewPlan) {
    return homebrewPlan;
  }

  if (process.platform === 'linux') {
    const aptPlan = createAptUpdatePlan(
      'ffmpeg',
      'ffmpeg',
      commands.ffmpegCommand,
      'ffmpeg apt package update completed. ffprobe is updated with the same package when apt provides it.'
    );
    if (aptPlan) {
      return aptPlan;
    }
  }

  return {
    supported: false,
    tool: 'ffmpeg',
    strategy: 'unsupported-installation',
    message:
      process.platform === 'darwin'
        ? 'Automatic ffmpeg updates are supported only when the configured ffmpeg executable is managed by Homebrew on macOS.'
        : 'Automatic ffmpeg updates are supported only when the configured ffmpeg executable is managed by Homebrew or apt on Linux.'
  };
}

function createYtDlpUpdatePlan(commands: ToolCommandConfig): ToolUpdatePlan {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return {
      supported: false,
      tool: 'yt-dlp',
      strategy: 'unsupported-platform',
      message: `Automatic yt-dlp updates are not supported on ${process.platform}.`
    };
  }

  const homebrewPlan = createHomebrewUpdatePlan(
    'yt-dlp',
    'yt-dlp',
    commands.ytDlpCommand,
    'yt-dlp Homebrew package update completed.'
  );
  if (homebrewPlan) {
    return homebrewPlan;
  }

  if (process.platform === 'linux') {
    const aptPlan = createAptUpdatePlan(
      'yt-dlp',
      'yt-dlp',
      commands.ytDlpCommand,
      'yt-dlp apt package update completed.'
    );
    if (aptPlan) {
      return aptPlan;
    }
  }

  const pipxPlan = createPipxYtDlpPlan(commands.ytDlpCommand);
  if (pipxPlan) {
    return pipxPlan;
  }

  const pipPlan = createPipManagedYtDlpPlan(commands.ytDlpCommand);
  if (pipPlan) {
    return pipPlan;
  }

  const selfUpdatePlan = createYtDlpSelfUpdatePlan(commands.ytDlpCommand);
  if (selfUpdatePlan) {
    return selfUpdatePlan;
  }

  return {
    supported: false,
    tool: 'yt-dlp',
    strategy: 'unsupported-installation',
    message:
      process.platform === 'darwin'
        ? 'Automatic yt-dlp updates are supported for Homebrew, pipx, user/virtualenv pip installs, or yt-dlp self-updating executables on macOS. The configured executable did not match one of those safe strategies.'
        : 'Automatic yt-dlp updates are supported for Homebrew, apt, pipx, user/virtualenv pip installs, or yt-dlp self-updating executables on Linux. The configured executable did not match one of those safe strategies.'
  };
}

function formatCommand(commandSpec: UpdateCommandSpec): string {
  return [commandSpec.command, ...commandSpec.args].join(' ');
}

async function runCapturedCommand(commandSpec: UpdateCommandSpec): Promise<CapturedCommandResult> {
  return await new Promise<CapturedCommandResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let isSettled = false;
    let didTimeOut = false;

    const child = spawn(commandSpec.command, commandSpec.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: commandSpec.env ?? process.env
    });

    const timeout = setTimeout(() => {
      if (isSettled) {
        return;
      }

      didTimeOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!isSettled) {
          child.kill('SIGKILL');
        }
      }, 2_000).unref?.();
    }, TOOL_UPDATE_COMMAND_TIMEOUT_MS);
    timeout.unref?.();

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout = appendCapturedOutput(stdout, chunk.toString());
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = appendCapturedOutput(stderr, chunk.toString());
    });

    child.on('error', (error) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: -1,
        stdout,
        stderr,
        errorMessage: error.message
      });
    });

    child.on('close', (exitCode) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: exitCode ?? -1,
        stdout,
        stderr,
        errorMessage: didTimeOut ? `Command timed out before completing.` : null
      });
    });
  });
}

function buildFailureMessage(plan: Extract<ToolUpdatePlan, { supported: true }>, result: CapturedCommandResult): string {
  const detail = result.errorMessage ?? (result.stderr.trim() || result.stdout.trim());
  if (detail === '') {
    return plan.failureMessage;
  }

  const singleLineDetail = detail
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);

  return `${plan.failureMessage} ${singleLineDetail}`;
}

async function executeToolUpdatePlan(plan: ToolUpdatePlan): Promise<ServerToolUpdateAttempt> {
  if (!plan.supported) {
    return {
      tool: plan.tool,
      attempted: false,
      status: 'unsupported',
      strategy: plan.strategy,
      command: null,
      exitCode: null,
      stdout: '',
      stderr: '',
      message: plan.message
    };
  }

  let combinedStdout = '';
  let combinedStderr = '';
  let lastExitCode: number | null = null;
  const commandSummaries = plan.commands.map(formatCommand);

  for (const commandSpec of plan.commands) {
    const result = await runCapturedCommand(commandSpec);
    lastExitCode = result.exitCode;
    combinedStdout = appendCapturedOutput(combinedStdout, result.stdout);
    combinedStderr = appendCapturedOutput(combinedStderr, result.stderr);

    if (result.exitCode !== 0 || result.errorMessage) {
      return {
        tool: plan.tool,
        attempted: true,
        status: 'failed',
        strategy: plan.strategy,
        command: formatCommand(commandSpec),
        exitCode: result.exitCode,
        stdout: combinedStdout,
        stderr: combinedStderr,
        message: buildFailureMessage(plan, result)
      };
    }
  }

  return {
    tool: plan.tool,
    attempted: true,
    status: 'success',
    strategy: plan.strategy,
    command: commandSummaries.join(' && '),
    exitCode: lastExitCode,
    stdout: combinedStdout,
    stderr: combinedStderr,
    message: plan.successMessage
  };
}

function createOverallUpdateSummary(status: ServerToolUpdateStatus): string {
  switch (status) {
    case 'success':
      return 'All server-side tools were updated.';
    case 'partial':
      return 'Some server-side tools were updated; some require attention.';
    case 'unsupported':
      return 'Automatic server-side tool updates are not supported in this environment.';
    case 'failed':
    default:
      return 'Server-side tool update failed.';
  }
}

function getOverallUpdateStatus(attempts: ServerToolUpdateAttempt[]): ServerToolUpdateStatus {
  const successCount = attempts.filter((attempt) => attempt.status === 'success').length;
  const unsupportedCount = attempts.filter((attempt) => attempt.status === 'unsupported').length;

  if (successCount === attempts.length) {
    return 'success';
  }

  if (successCount > 0) {
    return 'partial';
  }

  if (unsupportedCount === attempts.length) {
    return 'unsupported';
  }

  return 'failed';
}

export function detectToolAvailability(commands: ToolCommandConfig): ToolAvailability {
  return {
    ffmpeg: hasExecutable(commands.ffmpegCommand),
    ffprobe: hasExecutable(commands.ffprobeCommand),
    ytDlp: hasExecutable(commands.ytDlpCommand, ['--version'])
  };
}

export async function updateServerSideTools(commands: ToolCommandConfig): Promise<ServerToolUpdateResult> {
  const startedAt = new Date().toISOString();
  const plans = [createFfmpegUpdatePlan(commands), createYtDlpUpdatePlan(commands)];
  const tools: ServerToolUpdateAttempt[] = [];

  for (const plan of plans) {
    tools.push(await executeToolUpdatePlan(plan));
  }

  const status = getOverallUpdateStatus(tools);
  const finishedAt = new Date().toISOString();

  return {
    ok: status === 'success',
    status,
    platform: process.platform,
    startedAt,
    finishedAt,
    tools,
    summary: createOverallUpdateSummary(status)
  };
}
