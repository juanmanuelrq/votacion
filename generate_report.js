const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'odoo',
    host: 'odoo-db',
    database: 'postgres',
    password: 'odoo',
    port: 5432,
});

async function generateReport() {
    try {
        console.log('Generando informe...');
        let report = '# Informe de Votación\n\n';
        report += `Fecha de generación: ${new Date().toLocaleString()}\n\n`;

        // Resumen General
        const resAptos = await pool.query('SELECT COUNT(*) as total, SUM(coeficiente) as sum_coef FROM votacion.apartamentos');
        const resAsiste = await pool.query('SELECT COUNT(*) as total, SUM(coeficiente) as sum_coef FROM votacion.apartamentos WHERE asiste = true');
        
        report += '## Resumen General\n';
        report += `- **Total Apartamentos**: ${resAptos.rows[0].total}\n`;
        report += `- **Coeficiente Total**: ${parseFloat(resAptos.rows[0].sum_coef || 0).toFixed(4)}%\n`;
        report += `- **Asistentes Confirmados**: ${resAsiste.rows[0].total}\n`;
        report += `- **Coeficiente en Asamblea**: ${parseFloat(resAsiste.rows[0].sum_coef || 0).toFixed(4)}%\n\n`;

        // Preguntas y Resultados
        const resPreguntas = await pool.query('SELECT id, pregunta FROM votacion.preguntas ORDER BY id ASC');
        
        for (const pregunta of resPreguntas.rows) {
            report += `### Pregunta ${pregunta.id}: ${pregunta.pregunta}\n\n`;
            
            // Resultados por opción
            const queryRes = `
                SELECT 
                    o.opcion, 
                    COUNT(v.id) as votos, 
                    SUM(a.coeficiente) as coef
                FROM votacion.opciones o
                LEFT JOIN votacion.votos v ON o.id = v.opcion_id
                LEFT JOIN votacion.apartamentos a ON v.apartamento_id = a.id
                WHERE o.pregunta_id = $1
                GROUP BY o.id, o.opcion
                ORDER BY o.id ASC
            `;
            const resOpciones = await pool.query(queryRes, [pregunta.id]);
            
            report += '| Opción | Votos | Coeficiente Total |\n';
            report += '| :--- | :--- | :--- |\n';
            resOpciones.rows.forEach(opt => {
                report += `| ${opt.opcion} | ${opt.votos} | ${parseFloat(opt.coef || 0).toFixed(4)}% |\n`;
            });
            report += '\n';

            // Detalle de votos
            const queryDetalle = `
                SELECT 
                    a.numero as apto,
                    a.bloque,
                    o.opcion as respuesta,
                    v.fecha as fecha
                FROM votacion.votos v
                JOIN votacion.apartamentos a ON v.apartamento_id = a.id
                JOIN votacion.opciones o ON v.opcion_id = o.id
                WHERE v.pregunta_id = $1
                ORDER BY a.bloque ASC, a.numero ASC
            `;
            const resDetalle = await pool.query(queryDetalle, [pregunta.id]);
            
            if (resDetalle.rows.length > 0) {
                report += '<details><summary>Ver detalle de votos</summary>\n\n';
                report += '| Apto | Bloque | Respuesta | Fecha |\n';
                report += '| :--- | :--- | :--- | :--- |\n';
                resDetalle.rows.forEach(v => {
                    report += `| ${v.apto} | ${v.bloque || '-'} | ${v.respuesta} | ${new Date(v.fecha).toLocaleString()} |\n`;
                });
                report += '\n</details>\n\n';
            } else {
                report += '*No hay votos registrados para esta pregunta.*\n\n';
            }
            
            report += '---\n\n';
        }

        fs.writeFileSync('/app/informe_votacion.md', report);
        console.log('Informe generado en /app/informe_votacion.md');
    } catch (err) {
        console.error('Error al generar el informe:', err);
    } finally {
        pool.end();
    }
}

generateReport();
