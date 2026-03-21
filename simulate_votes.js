const { Pool } = require('pg');
const pool = new Pool({
    user: 'odoo',
    host: 'odoo-db',
    database: 'postgres',
    password: 'odoo',
    port: 5432,
});

async function run() {
    try {
        console.log('Inserting question...');
        const resQ = await pool.query("INSERT INTO votacion.preguntas (pregunta, activa) VALUES ('¿Qué color prefieres?', false) RETURNING id");
        const qId = resQ.rows[0].id;

        console.log('Inserting options...');
        const options = ['Rojo', 'Azul', 'Verde'];
        const optIds = [];
        for (const opt of options) {
            const resOpt = await pool.query("INSERT INTO votacion.opciones (pregunta_id, opcion) VALUES ($1, $2) RETURNING id", [qId, opt]);
            optIds.push(resOpt.rows[0].id);
        }

        console.log('Fetching apartments...');
        const aptos = await pool.query('SELECT id FROM votacion.apartamentos');

        console.log('Inserting votes...');
        for (const apto of aptos.rows) {
            const randomOpt = optIds[Math.floor(Math.random() * optIds.length)];
            await pool.query('INSERT INTO votacion.votos (pregunta_id, opcion_id, apartamento_id) VALUES ($1, $2, $3)', [qId, randomOpt, apto.id]);
        }

        console.log('Done simulating votes!');
    } catch (err) {
        console.error('Error:', err);
    } finally {
        pool.end();
    }
}
run();
