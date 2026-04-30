// src/lib/db-client.js
//
// Conexão dinâmica com o banco Neon do cliente.
//
// A connection string NÃO é uma ENV VAR do projeto —
// ela vem de event_configs.metadata.client_db_url, lida no callback.
// Isso permite escalar para N clientes sem nenhuma configuração de ambiente.
//
// Pools são cacheados por URL para reusar conexões entre requisições
// na mesma instância do servidor.

import { Pool } from "pg";

const pools = new Map();

function getPool(connectionString) {
  if (!connectionString) {
    throw new Error(
      "[db-client] client_db_url ausente no event_configs.metadata deste evento."
    );
  }

  if (!pools.has(connectionString)) {
    pools.set(
      connectionString,
      new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }, // Neon exige SSL
        max: 5,
      })
    );
  }

  return pools.get(connectionString);
}

/**
 * Executa uma query no banco do cliente.
 *
 * @param {string} connectionString  - Vem de event_configs.metadata.client_db_url
 * @param {string} text              - SQL parametrizado
 * @param {Array}  params            - Valores dos parâmetros
 */
export async function queryClient(connectionString, text, params) {
  const client = await getPool(connectionString).connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
