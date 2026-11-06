(() => {
  const api = globalThis.VseReports ||= {};

  const escapeXml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const encode = value => new TextEncoder().encode(value);
  const codeLabels = [
    ['okud', 'Код формы по ОКУД'],
    ['okpo', 'Код отчитывающейся организации по ОКПО'],
    ['okved', 'Код вида деятельности по ОКВЭД'],
    ['oktmo', 'Код территории по ОКТМО'],
    ['okogu', 'Код министерства (ведомства), органа управления по ОКОГУ'],
    ['okopf', 'Код организационно-правовой формы по ОКОПФ'],
    ['okfs', 'Код формы собственности по ОКФС'],
  ];

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let k = 0; k < 8; k += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[n] = value >>> 0;
    }
    return table;
  })();

  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const dosStamp = date => {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31),
      day: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31),
    };
  };

  const write16 = (view, offset, value) => view.setUint16(offset, value, true);
  const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);

  const zipStore = files => {
    const stamp = dosStamp(new Date());
    const prepared = files.map(file => {
      const name = encode(file.name);
      const data = typeof file.data === 'string' ? encode(file.data) : file.data;
      return { ...file, name, data, crc: crc32(data), offset: 0 };
    });
    const localSize = prepared.reduce((sum, file) => sum + 30 + file.name.length + file.data.length, 0);
    const centralSize = prepared.reduce((sum, file) => sum + 46 + file.name.length, 0);
    const output = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(output.buffer);
    let cursor = 0;
    prepared.forEach(file => {
      file.offset = cursor;
      write32(view, cursor, 0x04034b50); write16(view, cursor + 4, 20); write16(view, cursor + 6, 0x0800);
      write16(view, cursor + 8, 0); write16(view, cursor + 10, stamp.time); write16(view, cursor + 12, stamp.day);
      write32(view, cursor + 14, file.crc); write32(view, cursor + 18, file.data.length); write32(view, cursor + 22, file.data.length);
      write16(view, cursor + 26, file.name.length); write16(view, cursor + 28, 0);
      output.set(file.name, cursor + 30); output.set(file.data, cursor + 30 + file.name.length);
      cursor += 30 + file.name.length + file.data.length;
    });
    const centralOffset = cursor;
    prepared.forEach(file => {
      write32(view, cursor, 0x02014b50); write16(view, cursor + 4, 20); write16(view, cursor + 6, 20);
      write16(view, cursor + 8, 0x0800); write16(view, cursor + 10, 0); write16(view, cursor + 12, stamp.time); write16(view, cursor + 14, stamp.day);
      write32(view, cursor + 16, file.crc); write32(view, cursor + 20, file.data.length); write32(view, cursor + 24, file.data.length);
      write16(view, cursor + 28, file.name.length); write16(view, cursor + 30, 0); write16(view, cursor + 32, 0);
      write16(view, cursor + 34, 0); write16(view, cursor + 36, 0); write32(view, cursor + 38, 0); write32(view, cursor + 42, file.offset);
      output.set(file.name, cursor + 46); cursor += 46 + file.name.length;
    });
    write32(view, cursor, 0x06054b50); write16(view, cursor + 4, 0); write16(view, cursor + 6, 0);
    write16(view, cursor + 8, prepared.length); write16(view, cursor + 10, prepared.length);
    write32(view, cursor + 12, centralSize); write32(view, cursor + 16, centralOffset); write16(view, cursor + 20, 0);
    return output;
  };

  const cell = (reference, value, style = 0) => {
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  };
  const row = (index, cells, height) => `<row r="${index}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`;
  const columnName = index => String.fromCharCode(65 + index);

  const sheetXml = ({ dimension, cols, rows, merges = [], repeatRows = '', orientation = 'landscape' }) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${cols.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
  <sheetData>${rows.join('')}</sheetData>
  ${merges.length ? `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}
  ${repeatRows ? `<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="${orientation}" fitToWidth="1" fitToHeight="0"/><rowBreaks count="0" manualBreakCount="0"/>` : `<printOptions horizontalCentered="1"/><pageMargins left="0.35" right="0.35" top="0.45" bottom="0.45" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="${orientation}" fitToWidth="1" fitToHeight="1"/>`}
</worksheet>`;

  const buildHeaderSheet = report => {
    const half = report.half === 2 ? 'II' : 'I';
    const labels = codeLabels.map(([, label]) => label);
    const values = codeLabels.map(([key]) => report.codes?.[key] || '');
    const rows = [
      row(1, [cell('A1', 'СВЕДЕНИЯ О ВЕТЕРИНАРНО-САНИТАРНОЙ ЭКСПЕРТИЗЕ СЫРЬЯ И ПРОДУКТОВ ЖИВОТНОГО ПРОИСХОЖДЕНИЯ', 1)], 42),
      row(2, [cell('A2', `ЗА ${half} ПОЛУГОДИЕ ${report.year} Г.`, 2)], 25),
      row(4, [cell('A4', 'Представляют', 4), cell('D4', 'Сроки представления', 4), cell('F4', '5-вет', 5)], 24),
      row(5, [cell('A5', 'Уполномоченные в области ветеринарии органы исполнительной власти субъектов Российской Федерации Минсельхозу России (федеральному государственному бюджетному учреждению «Центр ветеринарии» — 129344, г. Москва, вн. тер. г. муниципальный округ Бабушкинский, ул. Летчика Бабушкина, д. 20)', 3), cell('D5', 'На 30-й день после отчетного периода', 4), cell('F5', 'Полугодовая', 5)], 84),
      row(7, [cell('A7', `Наименование отчитывающейся организации ${report.laboratoryName}`, 3)], 24),
      row(8, [cell('A8', `Адрес ${report.laboratoryAddress}`, 3)], 24),
      row(9, [cell('A9', '', 3), cell('B9', 'Код', 4)], 22),
      row(10, labels.map((label, index) => cell(`${columnName(index)}10`, label, 4)), 76),
      row(11, labels.map((_, index) => cell(`${columnName(index)}11`, index + 1, 6)), 22),
      row(12, values.map((value, index) => cell(`${columnName(index)}12`, value, 6)), 24),
    ];
    return sheetXml({
      dimension: 'A1:G12', cols: [19, 19, 19, 19, 21, 21, 27], rows,
      merges: ['A1:G1', 'A2:G2', 'A4:C4', 'D4:E4', 'F4:G4', 'A5:C5', 'D5:E5', 'F5:G5', 'A7:G7', 'A8:G8', 'B9:G9'],
      orientation: 'landscape',
    });
  };

  const buildReportSheet = report => {
    const rows = [
      row(1, [cell('A1', 'Раздел III', 2)], 28),
      row(2, [cell('A2', 'III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках', 2)], 32),
      row(4, [
        cell('A4', 'Наименование показателей', 4), cell('B4', '№ строки', 4),
        cell('C4', 'Крупный рогатый скот, яки, буйволы', 4), cell('D4', 'Свиньи', 4),
        cell('E4', 'Овцы, козы', 4), cell('F4', 'Кролики, нутрии', 4),
        cell('G4', 'Птица', 4), cell('I4', 'Рыба', 4), cell('J4', 'Другие виды животных', 4),
      ], 48),
      row(5, [cell('G5', 'куры', 4), cell('H5', 'другие виды', 4)], 30),
      row(6, Array.from({ length: 10 }, (_, index) => cell(`${columnName(index)}6`, index + 1, 6)), 22),
    ];
    api.rows.forEach((item, rowIndex) => {
      const excelRow = rowIndex + 7;
      const valueCells = api.columns.map((column, columnIndex) => {
        const value = Number(report.values?.[item.line]?.[column.key] || 0);
        return cell(`${columnName(columnIndex + 2)}${excelRow}`, value, item.mass ? 9 : 8);
      });
      rows.push(row(excelRow, [cell(`A${excelRow}`, item.label, 7), cell(`B${excelRow}`, item.line, 6), ...valueCells], item.label.length > 54 ? 30 : 22));
    });
    const lastRow = api.rows.length + 6;
    return sheetXml({
      dimension: `A1:J${lastRow}`, cols: [46, 10, 17, 14, 14, 14, 10, 11, 13, 17], rows,
      merges: ['A1:J1', 'A2:J2', 'A4:A5', 'B4:B5', 'C4:C5', 'D4:D5', 'E4:E5', 'F4:F5', 'G4:H4', 'I4:I5', 'J4:J5'],
      repeatRows: '4:6', orientation: 'landscape',
    });
  };

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="165" formatCode="0.000"/></numFmts>
  <fonts count="3">
    <font><sz val="10"/><name val="Times New Roman"/><family val="1"/><charset val="204"/></font>
    <font><b/><sz val="14"/><name val="Times New Roman"/><family val="1"/><charset val="204"/></font>
    <font><b/><sz val="12"/><name val="Times New Roman"/><family val="1"/><charset val="204"/></font>
  </fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  api.buildOfficialXlsx = report => {
    const created = new Date().toISOString();
    return zipStore([
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
      { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Форма 5-вет, раздел III</dc:title><dc:creator>Электронная лаборатория ВСЭ</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>` },
      { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Электронная лаборатория ВСЭ</Application><TitlesOfParts><vt:vector size="2" baseType="lpstr"><vt:lpstr>Шапка</vt:lpstr><vt:lpstr>Отчёт</vt:lpstr></vt:vector></TitlesOfParts></Properties>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Шапка" sheetId="1" r:id="rId1"/><sheet name="Отчёт" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: buildHeaderSheet(report) },
      { name: 'xl/worksheets/sheet2.xml', data: buildReportSheet(report) },
    ]);
  };

  api.downloadOfficialXlsx = (report, fileName) => {
    const bytes = api.buildOfficialXlsx(report);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
  };

  api.buildTableXlsx = ({ title, sheetName = 'Отчёт', columns = [], rows: dataRows = [] }) => {
    const created = new Date().toISOString();
    const lastColumn = columnName(Math.max(0, columns.length - 1));
    const rows = [
      row(1, [cell('A1', title, 1)], 34),
      row(3, columns.map((label, index) => cell(`${columnName(index)}3`, label, 4)), 30),
      ...dataRows.map((values, rowIndex) => row(rowIndex + 4, values.map((value, columnIndex) => cell(`${columnName(columnIndex)}${rowIndex + 4}`, value, typeof value === 'number' ? 8 : 7)), 23)),
    ];
    const worksheet = sheetXml({
      dimension: `A1:${lastColumn}${dataRows.length + 3}`,
      cols: columns.map((_, index) => index === 0 ? 42 : index === columns.length - 1 ? 18 : 22),
      rows,
      merges: [`A1:${lastColumn}1`],
      repeatRows: '3:3',
      orientation: 'landscape',
    });
    return zipStore([
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
      { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>Электронная лаборатория ВСЭ</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>` },
      { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Электронная лаборатория ВСЭ</Application><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${escapeXml(sheetName)}</vt:lpstr></vt:vector></TitlesOfParts></Properties>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: worksheet },
    ]);
  };

  api.downloadTableXlsx = (options, fileName) => {
    const bytes = api.buildTableXlsx(options);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
  };
})();
