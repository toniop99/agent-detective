export default {
  name: 'hook-b-plugin',
  version: '1.0.0',
  schemaVersion: '1.0',
  register(scope) {
    scope.addHook('onRequest', async (_req, reply) => {
      reply.header('x-plugin', 'b');
    });
    scope.get('/ping', async () => ({ ok: true }));
  },
};

