#!/usr/bin/env node
/**
 * Account administration from the command line (works with closed registration).
 * In the production container:
 *
 *   docker exec wrkhive-app node scripts/users.mjs list
 *   docker exec wrkhive-app node scripts/users.mjs add <email> <name> <password>
 *   docker exec wrkhive-app node scripts/users.mjs passwd <email> <password>
 *
 * Passwords are hashed exactly like the app does (scrypt, see src/lib/server/crypto.ts).
 * Changing a password signs the account out everywhere.
 */
import Database from "better-sqlite3";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
function newId(length = 12) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "wrkhive.db");
let db;
try {
  db = new Database(file, { fileMustExist: true });
} catch {
  fail(`Datenbank nicht gefunden: ${file}. Läuft Wrkhive schon einmal gestartet?`);
}
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const [cmd, ...args] = process.argv.slice(2);
const normEmail = (e) => String(e ?? "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const checkPassword = (p) => {
  if (!p || p.length < 8) fail("Das Passwort muss mindestens 8 Zeichen haben.");
};

switch (cmd) {
  case "list": {
    const rows = db.prepare("select email, name, is_demo, created_at, onboarded_at from users order by created_at").all();
    for (const r of rows) {
      console.log(`${r.email}\t${r.name}${r.is_demo ? "\t(Demo)" : ""}\tangelegt ${new Date(r.created_at).toISOString().slice(0, 10)}${r.onboarded_at ? "" : "\t(Einrichtung offen)"}`);
    }
    if (!rows.length) console.log("Noch keine Konten.");
    break;
  }
  case "add": {
    const [emailArg, name, password] = args;
    const email = normEmail(emailArg);
    if (!validEmail(email) || !name) fail("Aufruf: users.mjs add <email> <name> <passwort>");
    checkPassword(password);
    if (db.prepare("select 1 from users where email = ?").get(email)) fail(`${email} existiert bereits. Passwort ändern: users.mjs passwd ${email} <passwort>`);
    db.prepare("insert into users (id, email, name, password_hash) values (?, ?, ?, ?)").run(newId(), email, name.trim().slice(0, 60), await hashPassword(password));
    console.log(`Konto angelegt: ${email}. Beim ersten Anmelden startet die Einrichtung.`);
    break;
  }
  case "passwd": {
    const [emailArg, password] = args;
    const email = normEmail(emailArg);
    checkPassword(password);
    const user = db.prepare("select id from users where email = ?").get(email);
    if (!user) fail(`Kein Konto mit ${email}.`);
    const hash = await hashPassword(password);
    db.transaction(() => {
      db.prepare("update users set password_hash = ? where id = ?").run(hash, user.id);
      db.prepare("delete from sessions where user_id = ?").run(user.id);
    })();
    console.log(`Passwort für ${email} geändert, alle Sitzungen abgemeldet.`);
    break;
  }
  default:
    console.log("Befehle: list | add <email> <name> <passwort> | passwd <email> <passwort>");
    process.exit(cmd ? 1 : 0);
}
db.close();
