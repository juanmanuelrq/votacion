const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de la base de datos
const pool = new Pool({
    user: 'odoo',
    host: 'odoo-db',
    database: 'postgres',
    password: 'odoo',
    port: 5432,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Obtener las preguntas activas
app.get('/api/questions', async (req, res) => {
    const clave = req.query.clave;
    if (!clave) {
        return res.status(401).json({ error: 'Acceso denegado: Se requiere una clave válida.' });
    }

    try {
        // Validar apartamento
        const aptoResult = await pool.query('SELECT id, numero, bloque, nombre, coeficiente, asiste FROM votacion.apartamentos WHERE clave = $1', [clave]);
        if (aptoResult.rows.length === 0) {
            return res.status(401).json({ error: 'Acceso denegado: Clave inválida.' });
        }
        const apto = aptoResult.rows[0];

        if (!apto.asiste) {
            return res.status(403).json({ error: 'Tu asistencia no ha sido confirmada para la asamblea. Por favor, reporta tu asistencia con el administrador antes de votar.' });
        }

        const questionResult = await pool.query('SELECT id, pregunta FROM votacion.preguntas WHERE activa = true LIMIT 1');
        if (questionResult.rows.length === 0) {
            return res.status(404).json({ error: 'No hay preguntas activas' });
        }
        const question = questionResult.rows[0];

        // Verificar si el apartamento ya votó en esta pregunta
        const yaVotoResult = await pool.query('SELECT id FROM votacion.votos WHERE pregunta_id = $1 AND apartamento_id = $2', [question.id, apto.id]);
        if (yaVotoResult.rows.length > 0) {
            return res.status(403).json({ error: `El apartamento ${apto.numero} ya ha registrado su voto para esta pregunta.` });
        }

        const optionsResult = await pool.query('SELECT id, opcion FROM votacion.opciones WHERE pregunta_id = $1', [question.id]);

        res.json({
            id: question.id,
            pregunta: question.pregunta,
            opciones: optionsResult.rows,
            apartamento: apto.numero,
            bloque: apto.bloque,
            nombre: apto.nombre,
            coeficiente: apto.coeficiente
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Registrar un voto
app.post('/api/vote', async (req, res) => {
    const { questionId, optionId, clave } = req.body;

    if (!questionId || !optionId || !clave) {
        return res.status(400).json({ error: 'Faltan datos de votación o clave de acceso' });
    }

    try {
        // Validar apartamento
        const aptoResult = await pool.query('SELECT id, numero, asiste FROM votacion.apartamentos WHERE clave = $1', [clave]);
        if (aptoResult.rows.length === 0) {
            return res.status(401).json({ error: 'Clave inválida.' });
        }
        const apto = aptoResult.rows[0];

        if (!apto.asiste) {
            return res.status(403).json({ error: 'No puedes votar porque tu asistencia a la asamblea no ha sido confirmada.' });
        }

        // Intentar insertar el voto (fallará si ya existe por la restricción UNIQUE)
        await pool.query('INSERT INTO votacion.votos (pregunta_id, opcion_id, apartamento_id) VALUES ($1, $2, $3)', [questionId, optionId, apto.id]);
        res.json({ status: 'success' });
    } catch (err) {
        if (err.code === '23505') { // unique_violation code in postgres
            return res.status(403).json({ error: 'Este apartamento ya ha registrado un voto para esta pregunta.' });
        }
        console.error(err);
        res.status(500).json({ error: 'Error al registrar el voto' });
    }
});

// Obtener resultados de votaciones cerradas
app.get('/api/results', async (req, res) => {
    const clave = req.query.clave;
    if (!clave) {
        return res.status(401).json({ error: 'Acceso denegado: Se requiere una clave válida.' });
    }

    try {
        // Validar apartamento
        const aptoResult = await pool.query('SELECT id FROM votacion.apartamentos WHERE clave = $1', [clave]);
        if (aptoResult.rows.length === 0) {
            return res.status(401).json({ error: 'Acceso denegado: Clave inválida.' });
        }

        // Consultar resultados de preguntas inactivas sumando coeficientes
        const query = `
            SELECT 
                p.id AS pregunta_id, 
                p.pregunta, 
                o.id AS opcion_id, 
                o.opcion, 
                COALESCE(SUM(a.coeficiente), 0) AS suma_coeficientes,
                COUNT(v.id) AS cantidad_votos
            FROM votacion.preguntas p
            JOIN votacion.opciones o ON p.id = o.pregunta_id
            LEFT JOIN votacion.votos v ON o.id = v.opcion_id
            LEFT JOIN votacion.apartamentos a ON v.apartamento_id = a.id
            WHERE p.activa = false
            GROUP BY p.id, o.id
            ORDER BY p.id DESC, o.id ASC;
        `;
        const result = await pool.query(query);

        // Agrupar los resultados por pregunta
        const resultadosPorPregunta = {};
        result.rows.forEach(row => {
            if (!resultadosPorPregunta[row.pregunta_id]) {
                resultadosPorPregunta[row.pregunta_id] = {
                    pregunta: row.pregunta,
                    opciones: []
                };
            }
            resultadosPorPregunta[row.pregunta_id].opciones.push({
                opcion: row.opcion,
                suma_coeficientes: parseFloat(row.suma_coeficientes).toFixed(4),
                cantidad_votos: parseInt(row.cantidad_votos)
            });
        });

        res.json(Object.values(resultadosPorPregunta));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener resultados' });
    }
});

// ---------------- ADMIN PANEL ----------------

const auth = require('basic-auth');

// Middleware de autenticación básica
const adminAuth = (req, res, next) => {
    const credentials = auth(req);

    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

    if (!credentials || credentials.name !== ADMIN_USER || credentials.pass !== ADMIN_PASS) {
        res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
        return res.status(401).send('Acceso denegado');
    }
    next();
};

// Servir la página de administración (protegida)
app.get('/admin', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Crear una nueva pregunta (protegida)
app.post('/api/admin/questions', adminAuth, async (req, res) => {
    const { pregunta, opciones } = req.body;

    if (!pregunta || !opciones || !Array.isArray(opciones) || opciones.length < 2) {
        return res.status(400).json({ error: 'Faltan datos de la pregunta o hay menos de 2 opciones' });
    }

    if (opciones.length > 5) {
        return res.status(400).json({ error: 'No puedes tener más de 5 opciones' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Iniciar transacción

        // 1. Desactivar las preguntas anteriores
        await client.query('UPDATE votacion.preguntas SET activa = false');

        // 2. Insertar la nueva pregunta
        const insertQuestionResult = await client.query(
            'INSERT INTO votacion.preguntas (pregunta) VALUES ($1) RETURNING id',
            [pregunta]
        );
        const newQuestionId = insertQuestionResult.rows[0].id;

        // 3. Insertar las opciones
        for (const opcion of opciones) {
            await client.query(
                'INSERT INTO votacion.opciones (pregunta_id, opcion) VALUES ($1, $2)',
                [newQuestionId, opcion]
            );
        }

        await client.query('COMMIT'); // Finalizar transacción
        res.json({ status: 'success', id: newQuestionId });

    } catch (err) {
        await client.query('ROLLBACK'); // Revertir si hay error
        console.error('Error al crear la pregunta:', err);
        res.status(500).json({ error: 'Error al guardar la votación' });
    } finally {
        client.release();
    }
});

// Obtener preguntas activas (para admin)
app.get('/api/admin/questions/active', adminAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, pregunta FROM votacion.preguntas WHERE activa = true ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener preguntas activas:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Cerrar (desactivar) una pregunta manualmente
app.put('/api/admin/questions/:id/close', adminAuth, async (req, res) => {
    const questionId = req.params.id;
    try {
        await pool.query('UPDATE votacion.preguntas SET activa = false WHERE id = $1', [questionId]);
        res.json({ status: 'success' });
    } catch (err) {
        console.error('Error al cerrar la pregunta:', err);
        res.status(500).json({ error: 'Error al cerrar la pregunta' });
    }
});

// Obtener preguntas cerradas (para admin)
app.get('/api/admin/questions', adminAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, pregunta FROM votacion.preguntas WHERE activa = false ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener preguntas cerradas:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener informe detallado de votos para una pregunta (para admin)
app.get('/api/admin/questions/:id/report', adminAuth, async (req, res) => {
    const questionId = req.params.id;
    try {
        const query = `
            SELECT 
                a.numero AS apartamento,
                a.nombre AS nombre,
                a.coeficiente AS coeficiente,
                p.pregunta AS pregunta,
                o.opcion AS respuesta,
                v.fecha AS fecha_hora
            FROM votacion.votos v
            JOIN votacion.apartamentos a ON v.apartamento_id = a.id
            JOIN votacion.preguntas p ON v.pregunta_id = p.id
            JOIN votacion.opciones o ON v.opcion_id = o.id
            WHERE v.pregunta_id = $1
            ORDER BY NULLIF(regexp_replace(a.numero, '\\D', '', 'g'), '')::int ASC, a.numero ASC;
        `;
        const result = await pool.query(query, [questionId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener el informe:', err);
        res.status(500).json({ error: 'Error al obtener el informe' });
    }
});

// Obtener lista de apartamentos (para admin)
app.get('/api/admin/apartments', adminAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, bloque, numero, nombre, celular, asiste, clave FROM votacion.apartamentos ORDER BY bloque ASC NULLS LAST, NULLIF(regexp_replace(numero, \'\\D\', \'\', \'g\'), \'\')::int ASC, numero ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener apartamentos:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Actualizar nombre y celular de un apartamento (protegida)
app.put('/api/admin/apartments/:id', adminAuth, async (req, res) => {
    const aptoId = req.params.id;
    const { nombre, celular } = req.body;

    try {
        await pool.query(
            'UPDATE votacion.apartamentos SET nombre = $1, celular = $2 WHERE id = $3',
            [nombre || null, celular || null, aptoId]
        );
        res.json({ status: 'success' });
    } catch (err) {
        console.error('Error al actualizar apartamento:', err);
        res.status(500).json({ error: 'Error al actualizar apartamento' });
    }
});

// Alternar asistencia de un apartamento (protegida)
app.put('/api/admin/apartments/:id/attendance', adminAuth, async (req, res) => {
    const aptoId = req.params.id;
    const { asiste } = req.body;

    try {
        await pool.query(
            'UPDATE votacion.apartamentos SET asiste = $1 WHERE id = $2',
            [asiste, aptoId]
        );
        res.json({ status: 'success' });
    } catch (err) {
        console.error('Error al actualizar asistencia del apartamento:', err);
        res.status(500).json({ error: 'Error al actualizar asistencia' });
    }
});

// Eliminar una pregunta cerrada (protegida)
app.delete('/api/admin/questions/:id', adminAuth, async (req, res) => {
    const questionId = req.params.id;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar que esté inactiva
        const checkResult = await client.query('SELECT activa FROM votacion.preguntas WHERE id = $1', [questionId]);
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pregunta no encontrada' });
        }
        if (checkResult.rows[0].activa) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No se puede eliminar una pregunta activa' });
        }

        // Eliminar votos, opciones y pregunta
        await client.query('DELETE FROM votacion.votos WHERE pregunta_id = $1', [questionId]);
        await client.query('DELETE FROM votacion.opciones WHERE pregunta_id = $1', [questionId]);
        await client.query('DELETE FROM votacion.preguntas WHERE id = $1', [questionId]);

        await client.query('COMMIT');
        res.json({ status: 'success' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al eliminar la pregunta:', err);
        res.status(500).json({ error: 'Error al eliminar la pregunta' });
    } finally {
        client.release();
    }
});

// Simular votos para la pregunta activa (para admin)
app.post('/api/admin/questions/simulate', adminAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Buscar la pregunta activa
        const checkResult = await client.query('SELECT id FROM votacion.preguntas WHERE activa = true LIMIT 1');
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No hay ninguna pregunta activa para simular votos' });
        }
        const qId = checkResult.rows[0].id;

        // Obtener las opciones de esta pregunta
        const optResult = await client.query('SELECT id FROM votacion.opciones WHERE pregunta_id = $1', [qId]);
        if (optResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'La pregunta activa no tiene opciones' });
        }
        const optIds = optResult.rows.map(r => r.id);

        // Obtener los apartamentos que aún no han votado
        const aptoResult = await client.query(`
            SELECT id FROM votacion.apartamentos 
            WHERE id NOT IN (SELECT apartamento_id FROM votacion.votos WHERE pregunta_id = $1)
        `, [qId]);

        const aptos = aptoResult.rows;

        // Simular votos al azar
        for (const apto of aptos) {
            const randomOpt = optIds[Math.floor(Math.random() * optIds.length)];
            await client.query('INSERT INTO votacion.votos (pregunta_id, opcion_id, apartamento_id) VALUES ($1, $2, $3)', [qId, randomOpt, apto.id]);
        }

        // Cerrar (desactivar) la pregunta
        await client.query('UPDATE votacion.preguntas SET activa = false WHERE id = $1', [qId]);

        await client.query('COMMIT');
        res.json({ status: 'success', inserted: aptos.length });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al simular votos:', err);
        res.status(500).json({ error: 'Error al simular votos' });
    } finally {
        client.release();
    }
});

app.listen(PORT, () => {
    console.log(`Servidor de votación corriendo en el puerto ${PORT}`);
});
