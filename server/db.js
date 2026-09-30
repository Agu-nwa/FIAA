import pg from "pg";

const { Pool } = pg;

export function createDatabase(config, options = {}) {
  const pool = new Pool({
    connectionString: options.connectionString || config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: options.applicationName || "fiaa-commerce-api"
  });

  pool.on("error", error => {
    console.error("Unexpected idle PostgreSQL client error", { message: error.message });
  });

  return {
    query(text, values) {
      return pool.query(text, values);
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await work({ query: (text, values) => client.query(text, values) });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}
