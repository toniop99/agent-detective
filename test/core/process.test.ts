import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import cp from 'node:child_process';
import { shellQuote, wrapCommandWithPty, terminateChildProcess, execLocal, execLocalStreaming } from '../../src/core/process.js';

describe('process', () => {
  describe('shellQuote', () => {
    it('wraps empty string in single quotes', () => {
      assert.equal(shellQuote(''), "''");
    });

    it('escapes single quotes within string', () => {
      assert.equal(shellQuote("hello'world"), "'hello'\\''world'");
    });

    it('preserves unicode characters', () => {
      assert.equal(shellQuote('héllo wörld'), "'héllo wörld'");
    });

    it('preserves shell metacharacters inside quotes', () => {
      assert.equal(shellQuote('$HOME * ?'), "'$HOME * ?'");
    });

    it('handles string with multiple quotes', () => {
      assert.equal(shellQuote("it's a 'test'"), "'it'\\''s a '\\''test'\\'''");
    });
  });

  describe('wrapCommandWithPty', () => {
    it('wraps command with python pty spawn', () => {
      const result = wrapCommandWithPty('echo hello');
      assert.ok(result.includes('python3 -c'));
      assert.ok(result.includes('pty.spawn'));
      assert.ok(result.includes('echo hello'));
    });

    it('handles multiline commands', () => {
      const cmd = 'echo "line1" && echo "line2"';
      const result = wrapCommandWithPty(cmd);
      assert.ok(result.includes('pty.spawn'));
    });

    it('properly quotes the inner command', () => {
      const cmd = 'ls -la | grep test';
      const result = wrapCommandWithPty(cmd);
      assert.ok(result.includes("'ls -la | grep test'"));
    });
  });

  describe('terminateChildProcess', () => {
    it('does nothing when child is null', () => {
      terminateChildProcess(null);
      terminateChildProcess(null, 'SIGTERM');
    });

    it('calls kill on child process', () => {
      const mockChild = {
        kill: mock.fn(),
        pid: 12345,
      } as unknown as cp.ChildProcess;

      terminateChildProcess(mockChild, 'SIGTERM');
      assert.equal(mockChild.kill.mock.callCount(), 1);
      assert.equal(mockChild.kill.mock.calls[0].arguments[0], 'SIGTERM');
    });

    it('sends negative PID kill on unix for process group', () => {
      const mockKill = mock.fn();
      const mockChild = {
        kill: mockKill,
        pid: 12345,
      } as unknown as cp.ChildProcess;

      terminateChildProcess(mockChild, 'SIGTERM');
      assert.equal(mockKill.mock.callCount(), 1);
    });

    it('handles kill errors gracefully', () => {
      const mockChild = {
        kill: mock.fn(() => {
          throw new Error('Process already dead');
        }),
        pid: 12345,
      } as unknown as cp.ChildProcess;

      terminateChildProcess(mockChild, 'SIGTERM');
      assert.equal(mockChild.kill.mock.callCount(), 1);
    });
  });

  describe('execLocal', () => {
    it('executes command and returns stdout', async () => {
      const result = await execLocal('echo', ['hello']);
      assert.equal(result, 'hello\n');
    });

    it('rejects on command not found', async () => {
      await assert.rejects(
        () => execLocal('nonexistent_command_12345', []),
        (err: Error) => {
          assert.ok(err.message.includes('ENOENT') || err.message.includes('not found'));
          return true;
        }
      );
    });

    it('rejects with exit code on non-zero exit', async () => {
      await assert.rejects(
        () => execLocal('bash', ['-c', 'exit 42']),
        (err: Error) => {
          assert.ok(err.message.includes('42'));
          return true;
        }
      );
    });

    it('respects timeout option', async () => {
      await assert.rejects(
        () => execLocal('sleep', ['2'], { timeout: 100 }),
        (err: Error) => {
          assert.ok(err.message.includes('timed out'));
          return true;
        }
      );
    });

    it('respects maxBuffer option', async () => {
      await assert.rejects(
        () => execLocal('bash', ['-c', 'echo $(yes | head -c 10000)'], { maxBuffer: 100 }),
        (err: Error) => {
          assert.ok(err.message.includes('maxBuffer'));
          return true;
        }
      );
    });

    it('passes cwd option correctly', async () => {
      const result = await execLocal('pwd', [], { cwd: '/tmp' });
      assert.ok(result.includes('/tmp'));
    });

    it('passes environment variables', async () => {
      const result = await execLocal('bash', ['-c', 'echo $TEST_VAR'], {
        env: { ...process.env, TEST_VAR: 'my_value' }
      });
      assert.ok(result.includes('my_value'));
    });

    it('returns empty string on no output', async () => {
      const result = await execLocal('true', []);
      assert.equal(result, '');
    });
  });

  describe('execLocalStreaming', () => {
    it('calls onStdout callback with stdout data', async () => {
      const stdoutChunks: string[] = [];
      const result = await execLocalStreaming('echo', ['hello world'], {
        onStdout: (chunk) => stdoutChunks.push(chunk),
      });
      assert.ok(stdoutChunks.length > 0);
      assert.ok(stdoutChunks.join('').includes('hello'));
    });

    it('calls onStderr callback with stderr data', async () => {
      const stderrChunks: string[] = [];
      await execLocalStreaming('bash', ['-c', 'echo error >&2'], {
        onStderr: (chunk) => stderrChunks.push(chunk),
      });
      assert.ok(stderrChunks.length > 0);
    });

    it('combines stdout from multiple chunks', async () => {
      const stdoutChunks: string[] = [];
      await execLocalStreaming('bash', ['-c', 'echo line1 && echo line2'], {
        onStdout: (chunk) => stdoutChunks.push(chunk),
      });
      const combined = stdoutChunks.join('');
      assert.ok(combined.includes('line1') || combined.includes('line2'));
    });

    it('respects timeout and force kills after grace period', async () => {
      const start = Date.now();
      await assert.rejects(
        () =>
          execLocalStreaming('sleep', ['10'], {
            timeout: 100,
            onStdout: () => {},
          }),
        (err: Error) => {
          const elapsed = Date.now() - start;
          assert.ok(elapsed >= 100, `Expected elapsed >= 100, got ${elapsed}`);
          assert.ok(elapsed < 7000, `Expected elapsed < 7000, got ${elapsed}`);
          return true;
        }
      );
    });

    it('rejects when maxBuffer exceeded', async () => {
      await assert.rejects(
        () =>
          execLocalStreaming('bash', ['-c', 'yes | head -c 10000'], {
            maxBuffer: 100,
            onStdout: () => {},
          }),
        (err: Error) => {
          assert.ok(err.message.includes('maxBuffer') || err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
          return true;
        }
      );
    });

    it('calls onSpawn with child process', async () => {
      let spawnedChild: cp.ChildProcess | null = null;
      await execLocalStreaming('echo', ['test'], {
        onSpawn: (child) => {
          spawnedChild = child;
        },
      });
      assert.ok(spawnedChild !== null);
    });

    it('resolves with stdout on success', async () => {
      const result = await execLocalStreaming('echo', ['success']);
      assert.ok(result.includes('success'));
    });

    it('rejects on non-zero exit code', async () => {
      await assert.rejects(
        () => execLocalStreaming('bash', ['-c', 'exit 1']),
        (err: Error) => {
          assert.ok(err.message.includes('exit code 1') || err.code === 1);
          return true;
        }
      );
    });

    it('handles empty output gracefully', async () => {
      const result = await execLocalStreaming('true', []);
      assert.equal(result, '');
    });

    it('works without any callbacks', async () => {
      const result = await execLocalStreaming('echo', ['no callback']);
      assert.ok(result.includes('no callback'));
    });
  });
});