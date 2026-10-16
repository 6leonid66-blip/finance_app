import { DatabaseSync } from 'node:sqlite'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export function createVault(path, encodedKey) {
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) throw new Error('SYNC_ENCRYPTION_KEY must contain 32 random bytes in base64')
  const db = new DatabaseSync(path)
  db.exec(`pragma journal_mode=WAL; pragma secure_delete=ON;
    create table if not exists connections(id text primary key, owner text not null, household text not null,
      provider text not null, metadata text not null, secret text not null,
      unique(owner,household,provider));`)
  const aad = row => Buffer.from(JSON.stringify([row.id, row.owner, row.household, row.provider]))
  function seal(row, data) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(aad(row))
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
  }
  function decrypt(row) {
    const data = Buffer.from(row.secret, 'base64')
    const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
    cipher.setAAD(aad(row)); cipher.setAuthTag(data.subarray(12, 28))
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'))
  }
  const parse = row => row ? { ...row, metadata: JSON.parse(row.metadata) } : null
  return {
    get: id => parse(db.prepare('select * from connections where id=?').get(id)),
    list: () => db.prepare('select * from connections order by id').all().map(parse),
    insert(row, credentials) {
      db.prepare('insert into connections values(?,?,?,?,?,?)').run(row.id, row.owner, row.household, row.provider, JSON.stringify(row.metadata), seal(row, { credentials }))
    },
    update(id, metadata) { db.prepare('update connections set metadata=? where id=?').run(JSON.stringify(metadata), id) },
    decrypt,
    remove(id) { db.prepare('delete from connections where id=?').run(id) },
    close() { db.close(); key.fill(0) },
  }
}
