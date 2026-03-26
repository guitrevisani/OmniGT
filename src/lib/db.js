// src/lib/db.js
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Query simples — uso geral, sem transação
export async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// Retorna um client do pool para uso em transações manuais.
// O chamador é responsável por chamar client.release() no finally.
//
// Uso:
//   const client = await getClient();
//   try {
//     await client.query("BEGIN");
//     await client.query(...);
//     await client.query("COMMIT");
//   } catch (err) {
//     await client.query("ROLLBACK");
//     throw err;
//   } finally {
//     client.release();
//   }
export async function getClient() {
  return await pool.connect();
}
