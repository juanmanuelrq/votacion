const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
    user: 'odoo',
    host: 'odoo-db',
    database: 'postgres',
    password: 'odoo',
    port: 5432,
});

function generatePassword(length = 20) {
    // Solo alfanumerico: seguro en URLs sin encoding
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let password = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
        password += charset.charAt(Math.floor(Math.random() * n));
    }
    return password;
}

async function populateApartments() {
    const client = await pool.connect();
    let createdCount = 0;

    try {
        console.log("Iniciando creación de 159 apartamentos...");
        await client.query('BEGIN');

        // Limpiar tabla (Opcional, si queremos generar todo de cero)
        await client.query('TRUNCATE TABLE votacion.apartamentos CASCADE');

        // Generate random coeficientes that sum to 1
        let coeficientes = [];
        let sum = 0;
        for (let i = 0; i < 159; i++) {
            let val = Math.random() * 10 + 1; // random between 1 and 11
            coeficientes.push(val);
            sum += val;
        }
        coeficientes = coeficientes.map(val => val / sum);

        // Adjust the last one slightly to ensure exact sum to 1 due to floating point
        let currentSum = coeficientes.slice(0, 158).reduce((a, b) => a + b, 0);
        coeficientes[158] = 1 - currentSum;

        for (let i = 1; i <= 159; i++) {
            const aptoNumero = i.toString();
            const clave = generatePassword(20);
            const coef = coeficientes[i - 1].toFixed(6);

            await client.query(
                'INSERT INTO votacion.apartamentos (numero, clave, coeficiente) VALUES ($1, $2, $3)',
                [aptoNumero, clave, coef]
            );
            createdCount++;
        }

        await client.query('COMMIT');
        console.log(`¡Éxito! Se crearon ${createdCount} apartamentos con sus claves y coeficientes aleatorios.`);

        console.log("\nGuardando las claves generadas en un archivo para el administrador...");
        const { exec } = require('child_process');
        exec(`docker exec -i odoo-db psql -U odoo -d postgres -c "COPY (SELECT numero, clave, coeficiente FROM votacion.apartamentos) TO STDOUT WITH CSV HEADER" > /app/claves_apartamentos.csv`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error al exportar CSV: ${error.message}`);
                return;
            }
            console.log("Claves exportadas a /root/votacion/claves_apartamentos.csv");
        });


    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error poblando apartamentos:', err);
    } finally {
        client.release();
        pool.end();
    }
}

populateApartments();
