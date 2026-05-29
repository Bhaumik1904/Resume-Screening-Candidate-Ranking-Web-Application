const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');

/**
 * Generate a CSV buffer from results array
 * @param {Array} results - Array of candidate result objects
 * @returns {string} CSV string
 */
const generateCSV = (results) => {
  const fields = [
    { label: 'Rank', value: 'rank' },
    { label: 'Candidate Name', value: 'name' },
    { label: 'Email', value: 'email' },
    { label: 'Total Score', value: 'total_score' },
    { label: 'Skills Score (/25)', value: 'skills_score' },
    { label: 'Experience Score (/25)', value: 'experience_score' },
    { label: 'Education Score (/25)', value: 'education_score' },
    { label: 'Keyword Score (/25)', value: 'keyword_score' },
    { label: 'Matched Skills', value: (row) => (row.matched_skills || []).join(', ') },
    { label: 'Missing Skills', value: (row) => (row.missing_skills || []).join(', ') },
    { label: 'Summary', value: 'summary' },
  ];

  const parser = new Parser({ fields });
  return parser.parse(results);
};

/**
 * Generate an Excel workbook buffer from results array
 * @param {Array} results - Array of candidate result objects
 * @param {string} jobTitle - Title of the job for the sheet header
 * @returns {Promise<Buffer>} Excel file buffer
 */
const generateExcel = async (results, jobTitle = 'Resume Screening Results') => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Resume Screening App';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Candidates', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  // Title row
  sheet.mergeCells('A1:K1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = jobTitle;
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6366F1' } };
  sheet.getRow(1).height = 35;

  // Column headers
  sheet.columns = [
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'Candidate Name', key: 'name', width: 25 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Total Score', key: 'total_score', width: 14 },
    { header: 'Skills (/25)', key: 'skills_score', width: 14 },
    { header: 'Experience (/25)', key: 'experience_score', width: 16 },
    { header: 'Education (/25)', key: 'education_score', width: 16 },
    { header: 'Keywords (/25)', key: 'keyword_score', width: 15 },
    { header: 'Matched Skills', key: 'matched_skills', width: 40 },
    { header: 'Missing Skills', key: 'missing_skills', width: 40 },
    { header: 'Summary', key: 'summary', width: 60 },
  ];

  // Style header row (row 2)
  const headerRow = sheet.getRow(2);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF6366F1' } },
    };
  });
  headerRow.height = 22;

  // Data rows
  results.forEach((r, i) => {
    const row = sheet.addRow({
      rank: r.rank,
      name: r.name || 'Unknown',
      email: r.email || '—',
      total_score: r.total_score,
      skills_score: r.skills_score,
      experience_score: r.experience_score,
      education_score: r.education_score,
      keyword_score: r.keyword_score,
      matched_skills: (r.matched_skills || []).join(', '),
      missing_skills: (r.missing_skills || []).join(', '),
      summary: r.summary || '',
    });

    // Alternate row colors
    const bgColor = i % 2 === 0 ? 'FFF8F7FF' : 'FFFFFFFF';
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'top', wrapText: true };
    });

    // Color-code total score
    const scoreCell = row.getCell('total_score');
    const score = r.total_score;
    scoreCell.font = {
      bold: true,
      color: {
        argb: score >= 70 ? 'FF16A34A' : score >= 40 ? 'FFD97706' : 'FFDC2626',
      },
    };

    row.height = 60;
  });

  // Conditional formatting for score column
  sheet.addConditionalFormatting({
    ref: `D3:D${results.length + 2}`,
    rules: [
      {
        type: 'colorScale',
        cfvo: [
          { type: 'num', value: 0 },
          { type: 'num', value: 50 },
          { type: 'num', value: 100 },
        ],
        color: [{ argb: 'FFDC2626' }, { argb: 'FFFBBF24' }, { argb: 'FF16A34A' }],
        priority: 1,
      },
    ],
  });

  return workbook.xlsx.writeBuffer();
};

module.exports = { generateCSV, generateExcel };
