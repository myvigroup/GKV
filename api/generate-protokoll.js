// Vercel Serverless Function: Beratungsprotokoll als PDF generieren
// Trigger: Wird aufgerufen wenn Lead-Status auf "abgeschlossen" gesetzt wird
// ENV vars needed: SUPABASE_URL, SUPABASE_SERVICE_KEY

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

export const config = { api: { bodyParser: true }, maxDuration: 15 };

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server-Konfiguration fehlt' });
    }

    const headers = {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    };

    // Auth prüfen
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Nicht autorisiert' });
    }
    const token = authHeader.replace('Bearer ', '');
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Token ungültig' });

    const { kontakt_id } = req.body;
    if (!kontakt_id) {
        return res.status(400).json({ error: 'kontakt_id erforderlich' });
    }

    try {
        // Kontakt laden
        const kontaktRes = await fetch(
            `${SUPABASE_URL}/rest/v1/kontakte?id=eq.${kontakt_id}&select=*`,
            { headers }
        );
        const kontakte = await kontaktRes.json();
        if (!kontakte || kontakte.length === 0) {
            return res.status(404).json({ error: 'Kontakt nicht gefunden' });
        }
        const kontakt = kontakte[0];

        // Berater laden
        let berater = null;
        if (kontakt.berater_id) {
            const beraterRes = await fetch(
                `${SUPABASE_URL}/rest/v1/berater?id=eq.${kontakt.berater_id}&select=*`,
                { headers }
            );
            const beraterData = await beraterRes.json();
            if (beraterData && beraterData.length > 0) berater = beraterData[0];
        }

        // Berechnungen laden
        let berechnungen = [];
        const berechnungenRes = await fetch(
            `${SUPABASE_URL}/rest/v1/kunden_berechnungen?kontakt_id=eq.${kontakt_id}&select=*&order=created_at.desc`,
            { headers }
        );
        berechnungen = await berechnungenRes.json() || [];

        // PDF generieren
        const pdfBuffer = await generatePDF(kontakt, berater, berechnungen);
        const filename = `Beratungsprotokoll_${kontakt.nachname}_${kontakt.vorname}_${new Date().toISOString().slice(0, 10)}.pdf`;

        // PDF im Supabase Storage speichern
        const storagePath = `protokolle/${kontakt_id}/${filename}`;
        const uploadRes = await fetch(
            `${SUPABASE_URL}/storage/v1/object/kunden-dokumente/${storagePath}`,
            {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
                body: pdfBuffer,
            }
        );

        let storage_url = null;
        if (uploadRes.ok) {
            // Signed URL erstellen (1 Jahr gültig)
            const signRes = await fetch(
                `${SUPABASE_URL}/storage/v1/object/sign/kunden-dokumente/${storagePath}`,
                {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ expiresIn: 31536000 }),
                }
            );
            if (signRes.ok) {
                const signData = await signRes.json();
                storage_url = `${SUPABASE_URL}/storage/v1${signData.signedURL}`;
            }
        } else {
            console.warn('Storage upload failed, PDF wird nur als Download zurückgegeben');
        }

        // Dokument-Eintrag in DB speichern
        const dokEintrag = {
            kontakt_id: kontakt_id,
            berater_id: kontakt.berater_id || null,
            typ: 'beratungsprotokoll',
            dateiname: filename,
            storage_path: storagePath,
            storage_url: storage_url,
            dateigroesse: pdfBuffer.length,
            mime_type: 'application/pdf',
        };

        await fetch(`${SUPABASE_URL}/rest/v1/kontakt_dokumente`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify(dokEintrag),
        });

        // PDF auch als base64 zurückgeben für sofortigen Download
        const base64 = pdfBuffer.toString('base64');

        return res.status(200).json({
            pdf_base64: base64,
            filename,
            storage_url,
            stored: !!storage_url,
        });

    } catch (err) {
        console.error('PDF-Generierung fehlgeschlagen:', err);
        return res.status(500).json({ error: 'PDF-Generierung fehlgeschlagen', detail: err.message });
    }
}

function generatePDF(kontakt, berater, berechnungen) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 50, bottom: 50, left: 50, right: 50 },
            info: {
                Title: `Beratungsprotokoll – ${kontakt.vorname} ${kontakt.nachname}`,
                Author: berater ? `${berater.vorname} ${berater.nachname}` : 'mitNORM',
                Creator: 'mitNORM GKV-Beratung',
            },
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageWidth = doc.page.width - 100; // 50 margin each side
        const primaryColor = '#004283';
        const accentColor = '#06BADD';
        const gray600 = '#475569';
        const gray400 = '#94A3B8';
        const successColor = '#00B67A';

        // ═══════════════════════════════════════════
        // HEADER
        // ═══════════════════════════════════════════
        // Weißer Header mit Logo-Bild
        doc.rect(0, 0, doc.page.width, 90).fill('#FFFFFF');

        // Logo einfügen
        try {
            const logoPath = path.join(process.cwd(), 'mitnorm-logo.png');
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 50, 18, { height: 40 });
            } else {
                // Fallback: Text-Logo
                doc.font('Helvetica-Bold').fontSize(22).fillColor(primaryColor);
                doc.text('mit', 50, 28, { continued: true });
                doc.fillColor(accentColor).text('NORM', { continued: false });
            }
        } catch (e) {
            doc.font('Helvetica-Bold').fontSize(22).fillColor(primaryColor);
            doc.text('mit', 50, 28, { continued: true });
            doc.fillColor(accentColor).text('NORM', { continued: false });
        }

        // Rechts: Dokumenttyp
        doc.font('Helvetica-Bold').fontSize(14).fillColor(primaryColor);
        doc.text('Beratungsprotokoll', 300, 22, { align: 'right', width: pageWidth - 250 });
        doc.font('Helvetica').fontSize(9).fillColor(gray400);
        doc.text(`Erstellt am ${formatDate(new Date())}`, 300, 44, { align: 'right', width: pageWidth - 250 });

        // Blauer Trennbalken
        doc.rect(0, 88, doc.page.width, 3).fill(primaryColor);

        let y = 108;

        // ═══════════════════════════════════════════
        // VORGANGSINFORMATIONEN
        // ═══════════════════════════════════════════
        y = drawSectionTitle(doc, 'Vorgangsinformationen', y, primaryColor);

        const vorgangData = [
            ['Vorgangsnummer', kontakt.id ? kontakt.id.slice(0, 8).toUpperCase() : '–'],
            ['Typ', kontakt.code ? 'Kunde' : 'Kontakt'],
            ['Status', 'Abgeschlossen'],
            ['Erstellt am', kontakt.created_at ? formatDate(new Date(kontakt.created_at)) : '–'],
            ['Abgeschlossen am', formatDate(new Date())],
        ];
        if (berater) {
            vorgangData.push(['Berater', `${berater.vorname} ${berater.nachname}`]);
            if (berater.email) vorgangData.push(['Berater E-Mail', berater.email]);
            if (berater.telefon) vorgangData.push(['Berater Telefon', berater.telefon]);
        }
        y = drawKeyValueTable(doc, vorgangData, y, pageWidth);

        y += 10;

        // ═══════════════════════════════════════════
        // KUNDENDATEN
        // ═══════════════════════════════════════════
        y = drawSectionTitle(doc, 'Kundendaten', y, primaryColor);

        const kundenData = [
            ['Vorname', kontakt.vorname || '–'],
            ['Nachname', kontakt.nachname || '–'],
            ['E-Mail', kontakt.email || '–'],
            ['Telefon', kontakt.telefon || 'Nicht angegeben'],
        ];
        y = drawKeyValueTable(doc, kundenData, y, pageWidth);

        y += 10;

        // ═══════════════════════════════════════════
        // BERATUNGSGRUNDLAGEN / ECKDATEN
        // ═══════════════════════════════════════════
        y = checkPageBreak(doc, y, 200);
        y = drawSectionTitle(doc, 'Beratungsgrundlagen', y, primaryColor);

        const beschLabels = { angestellt: 'Angestellt', selbststaendig: 'Selbstständig', beamter: 'Beamter', rentner: 'Rentner', student: 'Student' };
        const famLabels = { ledig: 'Ledig', verheiratet: 'Verheiratet', geschieden: 'Geschieden', verwitwet: 'Verwitwet' };

        const eckdaten = [
            ['Brutto-Monatsgehalt', kontakt.gehalt ? `${Number(kontakt.gehalt).toLocaleString('de-DE')} €` : 'Nicht angegeben'],
            ['Beschäftigung', beschLabels[kontakt.beschaeftigung] || kontakt.beschaeftigung || 'Nicht angegeben'],
            ['Familienstand', famLabels[kontakt.familienstand] || kontakt.familienstand || 'Nicht angegeben'],
            ['Kinder', kontakt.kinder != null ? String(kontakt.kinder) : 'Nicht angegeben'],
            ['Aktuelle Krankenkasse', kontakt.aktuelle_kasse || 'Nicht angegeben'],
        ];
        y = drawKeyValueTable(doc, eckdaten, y, pageWidth);

        y += 10;

        // ═══════════════════════════════════════════
        // ERGEBNIS / KASSENVERGLEICH
        // ═══════════════════════════════════════════
        y = checkPageBreak(doc, y, 180);
        y = drawSectionTitle(doc, 'Ergebnis & Kassenvergleich', y, primaryColor);

        // Highlight-Box: Sparpotenzial
        if (kontakt.sparpotenzial_jahr && kontakt.sparpotenzial_jahr > 0) {
            y = checkPageBreak(doc, y, 70);
            doc.roundedRect(50, y, pageWidth, 55, 6)
                .fill('#F0FDF4');
            doc.font('Helvetica').fontSize(9).fillColor(gray600);
            doc.text('Jährliches Sparpotenzial', 65, y + 10);
            doc.font('Helvetica-Bold').fontSize(20).fillColor(successColor);
            doc.text(`${Number(kontakt.sparpotenzial_jahr).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`, 65, y + 25);
            doc.font('Helvetica').fontSize(9).fillColor(gray400);
            const monthly = (Number(kontakt.sparpotenzial_jahr) / 12);
            doc.text(`(${monthly.toLocaleString('de-DE', { minimumFractionDigits: 2 })} € pro Monat)`, 250, y + 30);
            y += 65;
        }

        const vergleichData = [
            ['Gewählte / Günstigste Kasse', kontakt.gewaehlte_kasse || 'Nicht angegeben'],
            ['Aktuelle Kasse', kontakt.aktuelle_kasse || 'Nicht angegeben'],
            ['Sparpotenzial (Jahr)', kontakt.sparpotenzial_jahr ? `${Number(kontakt.sparpotenzial_jahr).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €` : 'Nicht berechnet'],
        ];
        y = drawKeyValueTable(doc, vergleichData, y, pageWidth);

        // ═══════════════════════════════════════════
        // TOP 5 KASSEN (aus Berechnungen)
        // ═══════════════════════════════════════════
        const latestBerechnung = berechnungen[0];
        if (latestBerechnung && latestBerechnung.top5 && Array.isArray(latestBerechnung.top5) && latestBerechnung.top5.length > 0) {
            y += 15;
            y = checkPageBreak(doc, y, 180);
            y = drawSectionTitle(doc, 'Top Krankenkassen im Vergleich', y, primaryColor);

            const top5 = latestBerechnung.top5;
            const tableHeaders = ['#', 'Krankenkasse', 'Monatsbeitrag', 'Ersparnis/Jahr'];
            const colWidths = [30, pageWidth - 230, 100, 100];

            // Header
            doc.roundedRect(50, y, pageWidth, 22, 3).fill(primaryColor);
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
            let xPos = 58;
            tableHeaders.forEach((h, i) => {
                doc.text(h, xPos, y + 7, { width: colWidths[i], align: i >= 2 ? 'right' : 'left' });
                xPos += colWidths[i];
            });
            y += 22;

            // Rows
            top5.forEach((kasse, idx) => {
                y = checkPageBreak(doc, y, 25);
                const bgColor = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
                doc.rect(50, y, pageWidth, 22).fill(bgColor);

                doc.font('Helvetica-Bold').fontSize(8.5).fillColor(idx === 0 ? successColor : gray600);
                let rx = 58;
                doc.text(String(idx + 1), rx, y + 7, { width: colWidths[0] });
                rx += colWidths[0];
                doc.font('Helvetica').fillColor(gray600);
                doc.text(kasse.kasse || kasse.name || '–', rx, y + 7, { width: colWidths[1] });
                rx += colWidths[1];
                doc.text(kasse.beitrag != null ? `${Number(kasse.beitrag).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €` : '–', rx, y + 7, { width: colWidths[2], align: 'right' });
                rx += colWidths[2];
                const ersparnis = kasse.ersparnis_jahr != null ? kasse.ersparnis_jahr : kasse.ersparnis || 0;
                doc.fillColor(ersparnis > 0 ? successColor : gray600);
                doc.text(ersparnis ? `${Number(ersparnis).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €` : '–', rx, y + 7, { width: colWidths[3], align: 'right' });
                y += 22;
            });

            // Berechnungshinweis
            if (latestBerechnung.created_at) {
                y += 4;
                doc.font('Helvetica').fontSize(7).fillColor(gray400);
                doc.text(`Berechnung vom ${formatDate(new Date(latestBerechnung.created_at))}`, 50, y);
                y += 12;
            }
        }

        // ═══════════════════════════════════════════
        // BERECHNUNGSDETAILS (wenn vorhanden)
        // ═══════════════════════════════════════════
        if (latestBerechnung) {
            y += 5;
            y = checkPageBreak(doc, y, 120);
            y = drawSectionTitle(doc, 'Berechnungsdetails', y, primaryColor);

            const details = [
                ['Brutto-Gehalt (Berechnung)', latestBerechnung.gehalt ? `${Number(latestBerechnung.gehalt).toLocaleString('de-DE')} €` : '–'],
                ['Aktueller Beitrag', latestBerechnung.aktueller_beitrag ? `${Number(latestBerechnung.aktueller_beitrag).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €/Monat` : '–'],
                ['Günstigster Beitrag', latestBerechnung.guenstigster_beitrag ? `${Number(latestBerechnung.guenstigster_beitrag).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €/Monat` : '–'],
                ['Günstigste Kasse', latestBerechnung.guenstigste_kasse || '–'],
                ['Beschäftigung', beschLabels[latestBerechnung.beschaeftigung] || latestBerechnung.beschaeftigung || '–'],
                ['Familienstand', famLabels[latestBerechnung.familienstand] || latestBerechnung.familienstand || '–'],
                ['Kinder', latestBerechnung.kinder != null ? String(latestBerechnung.kinder) : '–'],
            ];
            y = drawKeyValueTable(doc, details, y, pageWidth);
        }

        // ═══════════════════════════════════════════
        // ZUSAMMENFASSUNG
        // ═══════════════════════════════════════════
        y += 15;
        y = checkPageBreak(doc, y, 100);
        y = drawSectionTitle(doc, 'Zusammenfassung', y, primaryColor);

        doc.font('Helvetica').fontSize(9).fillColor(gray600).lineGap(4);
        let summary = `Für ${kontakt.vorname} ${kontakt.nachname} wurde ein GKV-Vergleich durchgeführt. `;
        if (kontakt.aktuelle_kasse) summary += `Die aktuelle Krankenkasse ist ${kontakt.aktuelle_kasse}. `;
        if (kontakt.gewaehlte_kasse) summary += `Als günstigste Alternative wurde ${kontakt.gewaehlte_kasse} ermittelt. `;
        if (kontakt.sparpotenzial_jahr && kontakt.sparpotenzial_jahr > 0) {
            summary += `Das jährliche Einsparpotenzial beträgt ${Number(kontakt.sparpotenzial_jahr).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €. `;
        }
        summary += `\n\nDer Vorgang wurde am ${formatDate(new Date())} als abgeschlossen dokumentiert.`;
        if (berater) summary += ` Zuständiger Berater: ${berater.vorname} ${berater.nachname}.`;

        doc.text(summary, 50, y, { width: pageWidth, lineGap: 4 });
        y = doc.y + 15;

        // ═══════════════════════════════════════════
        // FOOTER
        // ═══════════════════════════════════════════
        y = checkPageBreak(doc, y, 60);
        doc.moveTo(50, y).lineTo(50 + pageWidth, y).lineWidth(0.5).strokeColor(gray400).stroke();
        y += 10;
        doc.font('Helvetica').fontSize(7).fillColor(gray400);
        doc.text('Dieses Dokument wurde automatisch erstellt und dient als Beratungsprotokoll im Sinne der Dokumentationspflichten für Finanzdienstleister.', 50, y, { width: pageWidth, align: 'center' });
        y += 14;
        doc.text(`mitNORM GmbH · Beratungsprotokoll · ${formatDate(new Date())} · Vorgangsnr. ${kontakt.id ? kontakt.id.slice(0, 8).toUpperCase() : '–'}`, 50, y, { width: pageWidth, align: 'center' });

        doc.end();
    });
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function drawSectionTitle(doc, title, y, color) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(color);
    doc.text(title.toUpperCase(), 50, y);
    y = doc.y + 3;
    doc.moveTo(50, y).lineTo(50 + 80, y).lineWidth(2).strokeColor(color).stroke();
    return y + 10;
}

function drawKeyValueTable(doc, data, startY, pageWidth) {
    let y = startY;
    const labelWidth = 180;
    const valueWidth = pageWidth - labelWidth;

    data.forEach((row, idx) => {
        y = checkPageBreak(doc, y, 22);
        const bgColor = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
        doc.rect(50, y, pageWidth, 20).fill(bgColor);

        doc.font('Helvetica').fontSize(8.5).fillColor('#64748B');
        doc.text(row[0], 60, y + 6, { width: labelWidth - 20 });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1E293B');
        doc.text(row[1], 50 + labelWidth, y + 6, { width: valueWidth - 10 });
        y += 20;
    });

    return y;
}

function checkPageBreak(doc, y, needed) {
    if (y + needed > doc.page.height - 60) {
        doc.addPage();
        return 50;
    }
    return y;
}

function formatDate(date) {
    return date.toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    }) + ', ' + date.toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit',
    });
}
