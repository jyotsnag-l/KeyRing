import PDFDocument from 'pdfkit';
// @ts-ignore
import { Parser } from 'json2csv';
import { IAuditEvent } from '../models/types';
import { db } from '../models/db';

/**
 * Generates a PDF document stream containing the formatted audit trail.
 */
export async function generateAuditPDF(events: IAuditEvent[]): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Title & Header
      doc.fontSize(22).fillColor('#1E293B').text('KeyRing Audit Trail Report', { align: 'center' });
      doc.fontSize(10).fillColor('#64748B').text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown(1.5);

      doc.fontSize(12).fillColor('#0F172A').text('This document contains the complete, cryptographically hash-chained audit log of all financial and account oversight delegations and actions.', { align: 'justify' });
      doc.moveDown(1);

      doc.strokeColor('#E2E8F0').lineWidth(1).moveTo(50, doc.y).lineTo(560, doc.y).stroke();
      doc.moveDown(1);

      // Loop through events
      for (let i = 0; i < events.length; i++) {
        const event = events[i];

        // Fetch actor details
        const actor = await db.users.findById(event.actorId);
        const actorName = actor ? `${actor.name} (${actor.role})` : (event.actorId === 'SYSTEM' ? 'SYSTEM' : 'Unknown');

        // Draw a light grey bounding box for each event
        doc.fillColor('#F8FAFC').rect(50, doc.y, 510, 85).fill();
        doc.fillColor('#0F172A');

        const boxStartY = doc.y;

        // Action details
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#3B82F6').text(`[Event #${i + 1}] Action: ${event.actionType.toUpperCase()}`, 60, boxStartY + 10);
        doc.fontSize(10).font('Helvetica').fillColor('#334155').text(`Actor: ${actorName}`, 60, boxStartY + 25);
        doc.text(`Details: ${event.target}`, 60, boxStartY + 37);
        if (event.amount !== null) {
          doc.text(`Amount: $${event.amount.toFixed(2)}`, 60, boxStartY + 49);
        }
        doc.fontSize(9).fillColor('#64748B').text(`Timestamp: ${new Date(event.timestamp).toLocaleString()}`, 60, boxStartY + 61);

        // Hashes (Right side inside box)
        doc.fontSize(7).fillColor('#94A3B8');
        doc.text(`Hash: ${event.eventHash.substring(0, 32)}...`, 300, boxStartY + 15);
        doc.text(`Prev: ${event.prevEventHash.substring(0, 32)}...`, 300, boxStartY + 28);

        // Verification status badge
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#10B981').text('✓ CHAIN VALIDATED', 300, boxStartY + 50);

        doc.y = boxStartY + 95; // spacing to next item

        // Page break if near bottom
        if (doc.y > 680) {
          doc.addPage();
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generates a CSV string containing the audit trail data.
 */
export function generateAuditCSV(events: any[]): string {
  const fields = [
    { label: 'Event ID', value: '_id' },
    { label: 'Grant ID', value: 'grantId' },
    { label: 'Actor ID', value: 'actorId' },
    { label: 'Action Type', value: 'actionType' },
    { label: 'Details/Target', value: 'target' },
    { label: 'Amount', value: 'amount' },
    { label: 'Timestamp', value: 'timestamp' },
    { label: 'Prev Event Hash', value: 'prevEventHash' },
    { label: 'Event Hash', value: 'eventHash' }
  ];

  const parser = new Parser({ fields });
  return parser.parse(events);
}
