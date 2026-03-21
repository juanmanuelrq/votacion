const { Pool } = require('pg');

const pool = new Pool({
    user: 'odoo',
    host: 'odoo-db',
    database: 'postgres',
    password: 'odoo',
    port: 5432,
});

async function main() {
    try {
        const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'votacion' AND table_name = 'apartamentos';");
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
main();
