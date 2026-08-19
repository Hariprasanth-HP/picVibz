const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const cols = await p.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='File' ORDER BY ordinal_position`);
  console.log('File columns:', cols.map(c=>c.column_name).join(', '));
  const types = await p.$queryRawUnsafe(`SELECT DISTINCT t.typname FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid`);
  console.log('Enums:', types.map(t=>t.typname).join(', '));
  await p.$disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
