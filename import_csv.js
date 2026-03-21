const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    user: 'odoo',
    host: 'odoo-db',
    database: 'postgres',
    password: 'odoo',
    port: 5432,
});

async function run() {
    const client = await pool.connect();
    try {
        console.log("Adding columns...");
        await client.query('ALTER TABLE votacion.apartamentos ADD COLUMN IF NOT EXISTS bloque VARCHAR(50)');
        await client.query('ALTER TABLE votacion.apartamentos ADD COLUMN IF NOT EXISTS nombre VARCHAR(255)');

        console.log("Truncating table...");
        await client.query('TRUNCATE TABLE votacion.apartamentos CASCADE');

        const content = fs.readFileSync('claves_apartamentos.csv', 'utf8');
        const lines = content.split('\n').filter(line => line.trim().length > 0);

        let count = 0;
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(';');
            if (parts.length < 5) continue; // Skip malformed
            const bloque = parts[0];
            const numero = parts[1];
            const nombre = parts[2];
            const coeficiente = parts[3];
            const clave = parts[4];
            const celular = parts[5] || null;

            await client.query(
                'INSERT INTO votacion.apartamentos (bloque, numero, nombre, coeficiente, clave, celular) VALUES ($1, $2, $3, $4, $5, $6)',
                [bloque, numero, nombre, coeficiente, clave, celular]
            );
            count++;
        }
        console.log(`Importación finalizada. ${count} apartamentos insertados.`);
    } catch (err) {
        console.error('Error importing:', err);
    } finally {
        client.release();
        pool.end();
    }
}

run();
