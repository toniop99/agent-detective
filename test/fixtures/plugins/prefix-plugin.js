export default {
  name: '@scope/name',
  version: '1.0.0',
  schemaVersion: '1.0',
  register(scope) {
    scope.get('/ping', async () => ({ ok: true }));
  },
};

