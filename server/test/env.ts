// Variáveis de ambiente dos testes (banco separado: clinica_test)
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://clinica:clinica_dev@localhost:5432/clinica_test';
process.env.APP_SECRET = 'test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
process.env.PUBLIC_URL = 'http://localhost:5173';
process.env.DISABLE_JOBS = '1';
process.env.WHATSAPP_PROVIDER = 'manual';
process.env.EMAIL_PROVIDER = 'log';
process.env.LOG_LEVEL = 'silent';
process.env.UPLOAD_DIR = '/tmp/jrs-test-uploads';
