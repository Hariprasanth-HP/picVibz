const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const files = await p.file.findMany({ where: { originalKey: { not: null } }, select: { id: true, originalKey: true, previewKey: true, mediumKey: true, status: true }, take: 3 });
  console.log(JSON.stringify(files, null, 1));
  const photos = await p.photo.findMany({ where: { file: { originalKey: { not: null } } }, select: { id: true, eventId: true, fileId: true }, take: 3 });
  console.log('photos:', JSON.stringify(photos));
  await p.$disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
