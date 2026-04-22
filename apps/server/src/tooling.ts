import { spawnSync } from 'node:child_process';
import type { ToolAvailability } from './types';

function hasExecutable(command: string, args: string[] = ['-version']): boolean {
  const result = spawnSync(command, args, {
    stdio: 'ignore'
  });

  return result.status === 0;
}

export function detectToolAvailability(): ToolAvailability {
  return {
    ffmpeg: hasExecutable('ffmpeg'),
    ffprobe: hasExecutable('ffprobe'),
    ytDlp: hasExecutable('yt-dlp', ['--version'])
  };
}
