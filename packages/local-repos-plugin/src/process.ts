import type { ChildProcess } from 'node:child_process';
import cp from 'node:child_process';

const FORCE_KILL_GRACE_MS = 5000;

export function shellQuote(value: string): string {
  const escaped = String(value).replace(/'/g, String.raw`'\''`);
  return `'${escaped}'`;
}

export function wrapCommandWithPty(command: string): string {
  const python = 'import pty,sys; pty.spawn(["bash","-lc", sys.argv[1]])';
  return `python3 -c ${shellQuote(python)} ${shellQuote(command)}`;
}

export function terminateChildProcess(child: ChildProcess | null, signal: string = 'SIGTERM'): void {
  if (!child) return;

  try {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      process.kill(-child.pid, signal as NodeJS.Signals);
      return;
    }
  } catch {
    // Ignore errors
  }

  try {
    child.kill(signal as NodeJS.Signals);
  } catch {
    // Ignore errors
  }
}

interface ExecError extends Error {
  code?: string | number;
  stderr?: string;
  stdout?: string;
  killed?: boolean;
  signal?: string;
}

export function execLocal(cmd: string, args: string[], options: { timeout?: number; maxBuffer?: number; [key: string]: unknown } = {}): Promise<string> {
  const { timeout, maxBuffer, ...rest } = options;

  return new Promise((resolve, reject) => {
    cp.execFile(cmd, args, { encoding: 'utf8', timeout, maxBuffer, ...rest }, (err, stdout, stderr) => {
      if (err) {
        const execErr = err as ExecError;
        execErr.stderr = stderr;
        execErr.stdout = stdout;
        if (timeout && execErr.killed) {
          const timeoutErr = new Error(`Command timed out after ${timeout}ms`) as ExecError;
          timeoutErr.code = 'ETIMEDOUT';
          timeoutErr.stderr = stderr;
          timeoutErr.stdout = stdout;
          return reject(timeoutErr);
        }
        return reject(execErr);
      }
      resolve(stdout || '');
    });
  });
}

export function execLocalStreaming(cmd: string, args: string[], options: { timeout?: number; maxBuffer?: number; onSpawn?: (child: ChildProcess) => void; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void; [key: string]: unknown } = {}): Promise<string> {
  const { timeout, maxBuffer, onSpawn, onStdout, onStderr, ...rest } = options;

  return new Promise((resolve, reject) => {
    const child = cp.spawn(cmd, args, {
      ...rest,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as ChildProcess;

    if (typeof onSpawn === 'function') {
      onSpawn(child);
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let killedByTimeout = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let forceKillHandle: NodeJS.Timeout | null = null;

    function cleanup(): void {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
        forceKillHandle = null;
      }
    }

    function finishError(err: ExecError): void {
      if (settled) return;
      settled = true;
      cleanup();
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    }

    function appendChunk(target: string, chunk: string): string | null {
      const next = target + chunk;
      if (maxBuffer && Buffer.byteLength(next, 'utf8') > maxBuffer) {
        const overflowErr = new Error(`Command output exceeded maxBuffer of ${maxBuffer} bytes`) as ExecError;
        overflowErr.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        terminateChildProcess(child, 'SIGKILL');
        finishError(overflowErr);
        return null;
      }
      return next;
    }

    if (timeout) {
      timeoutHandle = setTimeout(() => {
        killedByTimeout = true;
        terminateChildProcess(child, 'SIGTERM');
        forceKillHandle = setTimeout(() => {
          terminateChildProcess(child, 'SIGKILL');
        }, FORCE_KILL_GRACE_MS);
        if (typeof forceKillHandle.unref === 'function') {
          forceKillHandle.unref();
        }
      }, timeout);
      if (typeof timeoutHandle.unref === 'function') {
        timeoutHandle.unref();
      }
    }

    if (child.stdout) {
      if (typeof child.stdout.setEncoding === 'function') {
        child.stdout.setEncoding('utf8');
      }
      child.stdout.on('data', (chunk: string) => {
        if (settled) return;
        const result = appendChunk(stdout, chunk);
        if (result === null) return;
        stdout = result;
        if (settled) return;
        if (typeof onStdout === 'function') {
          onStdout(chunk);
        }
      });
    }

    if (child.stderr) {
      if (typeof child.stderr.setEncoding === 'function') {
        child.stderr.setEncoding('utf8');
      }
      child.stderr.on('data', (chunk: string) => {
        if (settled) return;
        const result = appendChunk(stderr, chunk);
        if (result === null) return;
        stderr = result;
        if (settled) return;
        if (typeof onStderr === 'function') {
          onStderr(chunk);
        }
      });
    }

    child.once('error', (err: Error) => {
      finishError(err as ExecError);
    });

    child.once('close', (code: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (killedByTimeout) {
        const timeoutErr = new Error(`Command timed out after ${timeout}ms`) as ExecError;
        timeoutErr.code = 'ETIMEDOUT';
        timeoutErr.signal = signal ?? undefined;
        timeoutErr.stdout = stdout;
        timeoutErr.stderr = stderr;
        reject(timeoutErr);
        return;
      }

      if (code !== 0) {
        const err = new Error(`Command failed with exit code ${code}`) as ExecError;
        err.code = code ?? undefined;
        err.signal = signal ?? undefined;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }

      resolve(stdout || '');
    });
  });
}
