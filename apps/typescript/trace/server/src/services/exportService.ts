import ExcelJS from 'exceljs';
import { VerificationTask } from '../types/index.js';

/**
 * Excel & CSV Export Service
 * Generates genuine multi-sheet .xlsx workbooks and RFC-compliant CSVs
 * containing complete verification records, Evidence Chains, question answers, full transcripts, and operational recommendations.
 */

export async function generateTasksExcelWorkbook(
  tasks: VerificationTask[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TRACE Supply-Chain Verification Engine';
  workbook.created = new Date();

  // -------------------------------------------------------------
  // SHEET 1: Verification Summary
  // -------------------------------------------------------------
  const summarySheet = workbook.addWorksheet('Verification Summary');
  summarySheet.columns = [
    { header: 'Verification ID', key: 'id', width: 25 },
    { header: 'Created At', key: 'createdAt', width: 22 },
    { header: 'Supplier / Entity', key: 'organization', width: 28 },
    { header: 'Item / Material', key: 'item', width: 28 },
    { header: 'Verification Type', key: 'verificationType', width: 24 },
    { header: 'Phone Number', key: 'phone', width: 18 },
    { header: 'Call State', key: 'callState', width: 16 },
    { header: 'Outcome', key: 'outcome', width: 24 },
    { header: 'Review Status', key: 'reviewStatus', width: 16 },
    { header: 'Quantitative Diff', key: 'difference', width: 28 },
    { header: 'Operational Impact', key: 'operationalImpact', width: 45 },
    { header: 'Action Recommendation', key: 'recommendation', width: 45 },
    { header: 'Confidence', key: 'confidence', width: 14 },
    { header: 'Contact Name', key: 'contact', width: 20 },
    { header: 'Duration (s)', key: 'duration', width: 14 },
    { header: 'Mode', key: 'mode', width: 12 },
  ];

  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };

  tasks.forEach((t) => {
    summarySheet.addRow({
      id: t.id,
      createdAt: t.createdAt,
      organization: t.target.organizationName,
      item: t.item || 'N/A',
      verificationType: t.verificationType || 'General',
      phone: t.target.phoneNumber,
      callState: t.callState,
      outcome: t.status,
      reviewStatus: t.reviewStatus || 'NONE',
      difference: t.reconciliation?.difference || t.evidenceChain?.difference || 'None',
      operationalImpact: t.reconciliation?.operationalImpact || t.evidenceChain?.operationalImpact || 'N/A',
      recommendation: t.reconciliation?.recommendation || t.evidenceChain?.recommendation || 'N/A',
      confidence: t.reconciliation?.confidence || t.structuredResult?.verification_confidence || 'N/A',
      contact: t.structuredResult?.contact_name || t.target.contactPerson || 'Staff',
      duration: t.callRecord?.durationSeconds ?? 0,
      mode: t.mode,
    });
  });

  // -------------------------------------------------------------
  // SHEET 2: Evidence Chains
  // -------------------------------------------------------------
  const chainSheet = workbook.addWorksheet('Evidence Chains');
  chainSheet.columns = [
    { header: 'Verification ID', key: 'taskId', width: 25 },
    { header: 'Supplier / Entity', key: 'organization', width: 28 },
    { header: 'Item / Material', key: 'item', width: 28 },
    { header: '1. Source Claim', key: 'sourceClaim', width: 35 },
    { header: '2. Phone Evidence', key: 'phoneEvidence', width: 45 },
    { header: '3. Structured Facts', key: 'structuredFact', width: 35 },
    { header: '4. Deterministic Comparison', key: 'comparison', width: 35 },
    { header: '5. Outcome', key: 'outcome', width: 24 },
    { header: '6. Operational Impact', key: 'impact', width: 45 },
    { header: '7. Recommendation', key: 'recommendation', width: 45 },
  ];

  chainSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  chainSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };

  tasks.forEach((t) => {
    const chain = t.evidenceChain || t.reconciliation?.evidenceChain;
    if (chain) {
      chainSheet.addRow({
        taskId: t.id,
        organization: t.target.organizationName,
        item: t.item,
        sourceClaim: chain.sourceClaim,
        phoneEvidence: chain.phoneEvidence,
        structuredFact: JSON.stringify(chain.structuredFact || {}),
        comparison: chain.comparison,
        outcome: chain.outcome,
        impact: chain.operationalImpact,
        recommendation: chain.recommendation,
      });
    }
  });

  // -------------------------------------------------------------
  // SHEET 3: Question Answers
  // -------------------------------------------------------------
  const questionsSheet = workbook.addWorksheet('Question Answers');
  questionsSheet.columns = [
    { header: 'Verification ID', key: 'taskId', width: 25 },
    { header: 'Supplier / Entity', key: 'organization', width: 28 },
    { header: 'Question Order', key: 'order', width: 15 },
    { header: 'Verification Question', key: 'question', width: 40 },
    { header: 'Expected Type', key: 'type', width: 15 },
    { header: 'Structured Answer', key: 'answer', width: 25 },
    { header: 'Confidence', key: 'confidence', width: 14 },
    { header: 'Evidence Quote', key: 'evidence', width: 50 },
  ];

  questionsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  questionsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };

  tasks.forEach((t) => {
    const answersMap = t.structuredResult?.question_answers || {};
    t.questions.forEach((q) => {
      const ans = answersMap[q.id];
      questionsSheet.addRow({
        taskId: t.id,
        organization: t.target.organizationName,
        order: q.order,
        question: q.question,
        type: q.expectedType,
        answer: ans ? String(ans.answer ?? 'N/A') : 'N/A',
        confidence: ans?.confidence || 'N/A',
        evidence: ans?.evidence || 'N/A',
      });
    });
  });

  // -------------------------------------------------------------
  // SHEET 4: Full Transcripts
  // -------------------------------------------------------------
  const transcriptSheet = workbook.addWorksheet('Transcripts');
  transcriptSheet.columns = [
    { header: 'Verification ID', key: 'taskId', width: 25 },
    { header: 'Supplier / Entity', key: 'organization', width: 28 },
    { header: 'Turn #', key: 'turnIndex', width: 10 },
    { header: 'Timestamp', key: 'timestamp', width: 16 },
    { header: 'Speaker', key: 'speaker', width: 18 },
    { header: 'Utterance / Dialogue', key: 'text', width: 70 },
  ];

  transcriptSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  transcriptSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };

  tasks.forEach((t) => {
    const turns = t.callRecord?.transcriptTurns || [];
    turns.forEach((turn, idx) => {
      transcriptSheet.addRow({
        taskId: t.id,
        organization: t.target.organizationName,
        turnIndex: idx + 1,
        timestamp: turn.timestamp,
        speaker: turn.speaker === 'AI' ? 'TRACE Agent (AI)' : 'Staff Representative',
        text: turn.text,
      });
    });
  });

  // -------------------------------------------------------------
  // SHEET 5: Raw Results JSON
  // -------------------------------------------------------------
  const rawSheet = workbook.addWorksheet('Raw Results');
  rawSheet.columns = [
    { header: 'Verification ID', key: 'taskId', width: 25 },
    { header: 'Supplier / Entity', key: 'organization', width: 28 },
    { header: 'Raw Structured Result JSON', key: 'json', width: 80 },
  ];

  rawSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  rawSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };

  tasks.forEach((t) => {
    rawSheet.addRow({
      taskId: t.id,
      organization: t.target.organizationName,
      json: JSON.stringify(t.structuredResult || t.callRecord?.structuredResult || {}, null, 2),
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Generate standard CSV format of the verification tasks summary
 */
export function generateTasksCsv(tasks: VerificationTask[]): string {
  const headers = [
    'Verification ID',
    'Created At',
    'Supplier / Entity',
    'Item / Material',
    'Verification Type',
    'Phone Number',
    'Call State',
    'Outcome',
    'Review Status',
    'Quantitative Difference',
    'Operational Impact',
    'Action Recommendation',
    'Confidence',
    'Mode',
  ];

  const rows = tasks.map((t) => [
    `"${t.id}"`,
    `"${t.createdAt}"`,
    `"${t.target.organizationName.replace(/"/g, '""')}"`,
    `"${(t.item || '').replace(/"/g, '""')}"`,
    `"${(t.verificationType || '').replace(/"/g, '""')}"`,
    `"${t.target.phoneNumber}"`,
    `"${t.callState}"`,
    `"${t.status}"`,
    `"${t.reviewStatus || 'NONE'}"`,
    `"${(t.reconciliation?.difference || t.evidenceChain?.difference || 'None').replace(/"/g, '""')}"`,
    `"${(t.reconciliation?.operationalImpact || t.evidenceChain?.operationalImpact || 'N/A').replace(/"/g, '""')}"`,
    `"${(t.reconciliation?.recommendation || t.evidenceChain?.recommendation || 'N/A').replace(/"/g, '""')}"`,
    `"${t.reconciliation?.confidence || t.structuredResult?.verification_confidence || 'NONE'}"`,
    `"${t.mode}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
