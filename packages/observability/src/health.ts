import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from './logger.js';
import type { ObservabilityHealthConfig } from './config.js';

const execAsync = promisify(exec);

export interface HealthCheckResult {
  name: string;
  status: 'ok' | 'degraded' | 'unhealthy';
  durationMs: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    server: HealthCheckResult;
    plugins?: HealthCheckResult;
    git?: HealthCheckResult;
    repos?: HealthCheckResult;
  };
}

export interface HealthChecker {
  check(): Promise<HealthStatus>;
  registerPluginCheck(name: string, checkFn: () => Promise<HealthCheckResult>): void;
  registerRepoCheck(checkFn: () => Promise<HealthCheckResult>): void;
}

export function createHealthChecker(
  config: ObservabilityHealthConfig,
  logger: Logger
): HealthChecker {
  const healthLogger = logger.child('health');
  const pluginChecks: Array<() => Promise<HealthCheckResult>> = [];
  const repoChecks: Array<() => Promise<HealthCheckResult>> = [];

  async function checkGit(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await execAsync('git --version', { timeout: 5000 });
      return {
        name: 'git',
        status: 'ok',
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        name: 'git',
        status: 'degraded',
        durationMs: Date.now() - start,
        message: (err as Error).message,
      };
    }
  }

  function aggregateStatus(results: HealthCheckResult[]): 'ok' | 'degraded' | 'unhealthy' {
    if (results.some((r) => r.status === 'unhealthy')) return 'unhealthy';
    if (results.some((r) => r.status === 'degraded')) return 'degraded';
    return 'ok';
  }

  async function check(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = {
      server: {
        name: 'server',
        status: 'ok',
        durationMs: 0,
      },
    };

    const allResults: HealthCheckResult[] = [checks.server];

    if (config.includePlugins && pluginChecks.length > 0) {
      const start = Date.now();
      try {
        const results = await Promise.all(pluginChecks.map((fn) => fn()));
        checks.plugins = {
          name: 'plugins',
          status: aggregateStatus(results),
          durationMs: Date.now() - start,
          details: {
            pluginChecks: results.length,
            results: results.map((r) => ({ name: r.name, status: r.status })),
          },
        };
        allResults.push(checks.plugins);
      } catch (err) {
        checks.plugins = {
          name: 'plugins',
          status: 'degraded',
          durationMs: Date.now() - start,
          message: (err as Error).message,
        };
        allResults.push(checks.plugins);
      }
    }

    if (config.includeGit) {
      checks.git = await checkGit();
      allResults.push(checks.git);
    }

    if (repoChecks.length > 0 && config.deep) {
      const start = Date.now();
      try {
        const results = await Promise.all(repoChecks.map((fn) => fn()));
        const totalRepos = results.reduce(
          (sum, r) => sum + ((r.details?.total as number) || 0),
          0
        );
        const availableRepos = results.reduce(
          (sum, r) => sum + ((r.details?.available as number) || 0),
          0
        );
        checks.repos = {
          name: 'repos',
          status: availableRepos === totalRepos ? 'ok' : 'degraded',
          durationMs: Date.now() - start,
          details: { total: totalRepos, available: availableRepos },
        };
        allResults.push(checks.repos);
      } catch (err) {
        checks.repos = {
          name: 'repos',
          status: 'degraded',
          durationMs: Date.now() - start,
          message: (err as Error).message,
        };
        allResults.push(checks.repos);
      }
    }

    const overallStatus = aggregateStatus(allResults);

    if (overallStatus === 'degraded') {
      healthLogger.warn('Health check degraded', {
        checks: allResults.map((c) => ({ name: c.name, status: c.status })),
      });
    } else if (overallStatus === 'unhealthy') {
      healthLogger.error('Health check unhealthy', undefined, {
        checks: allResults.map((c) => ({ name: c.name, status: c.status })),
      });
    } else {
      healthLogger.info('Health check ok', {
        durationMs: allResults.reduce((sum, c) => sum + c.durationMs, 0),
      });
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  function registerPluginCheck(name: string, checkFn: () => Promise<HealthCheckResult>): void {
    pluginChecks.push(async () => {
      try {
        return await checkFn();
      } catch (err) {
        return {
          name,
          status: 'degraded' as const,
          durationMs: 0,
          message: (err as Error).message,
        };
      }
    });
  }

  function registerRepoCheck(checkFn: () => Promise<HealthCheckResult>): void {
    repoChecks.push(checkFn);
  }

  return {
    check,
    registerPluginCheck,
    registerRepoCheck,
  };
}
