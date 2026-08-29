import { describe, expect, it } from 'vitest'

import {
  LEAD_ATTACHMENT_MAX_BYTES,
  LEAD_ATTACHMENT_MAX_FILES,
  LEAD_ATTACHMENT_MAX_TOTAL_BYTES,
  attachmentBytesMatch,
  attachmentExtension,
  attachmentMimeMatchesExtension,
  attachmentSha256,
  isAllowedAttachmentName,
  resolveManagedLeadAttachmentPath,
} from '@/modules/lead-attachments/files'

describe('lead attachment files validation', () => {
  it('exports expected limits and retention constants', () => {
    expect(LEAD_ATTACHMENT_MAX_BYTES).toBe(50 * 1024 * 1024)
    expect(LEAD_ATTACHMENT_MAX_FILES).toBe(5)
    expect(LEAD_ATTACHMENT_MAX_TOTAL_BYTES).toBe(200 * 1024 * 1024)
  })

  it('correctly identifies allowed filenames and extensions', () => {
    expect(attachmentExtension('drawing.DWG')).toBe('.dwg')
    expect(isAllowedAttachmentName('facade-drawing.dwg')).toBe(true)
    expect(isAllowedAttachmentName('facade-drawing.dxf')).toBe(true)
    expect(isAllowedAttachmentName('facade-model.step')).toBe(true)
    expect(isAllowedAttachmentName('facade-model.stp')).toBe(true)
    expect(isAllowedAttachmentName('canopy.3dm')).toBe(true)
    expect(isAllowedAttachmentName('profile.iges')).toBe(true)
    expect(isAllowedAttachmentName('profile.igs')).toBe(true)
    expect(isAllowedAttachmentName('boq-schedule.xlsx')).toBe(true)
    expect(isAllowedAttachmentName('boq-schedule.xls')).toBe(true)
    expect(isAllowedAttachmentName('boq-schedule.csv')).toBe(true)
    expect(isAllowedAttachmentName('drawings.zip')).toBe(true)
    expect(isAllowedAttachmentName('drawings.rar')).toBe(true)
    expect(isAllowedAttachmentName('drawings.7z')).toBe(true)
    expect(isAllowedAttachmentName('specification.pdf')).toBe(true)
    expect(isAllowedAttachmentName('elevation.jpg')).toBe(true)
    expect(isAllowedAttachmentName('elevation.jpeg')).toBe(true)
    expect(isAllowedAttachmentName('elevation.png')).toBe(true)
    expect(isAllowedAttachmentName('elevation.webp')).toBe(true)

    // Invalid or dangerous extensions
    expect(isAllowedAttachmentName('script.sh')).toBe(false)
    expect(isAllowedAttachmentName('malware.exe')).toBe(false)
    expect(isAllowedAttachmentName('payload.php')).toBe(false)
    expect(isAllowedAttachmentName('bad.bat')).toBe(false)
    expect(isAllowedAttachmentName('')).toBe(false)

    // Path traversal attempts
    expect(isAllowedAttachmentName('../secret.pdf')).toBe(false)
    expect(isAllowedAttachmentName('/etc/passwd')).toBe(false)
    expect(isAllowedAttachmentName('folder/file.dwg')).toBe(false)
  })

  it('matches MIME types to allowed extensions', () => {
    expect(attachmentMimeMatchesExtension('application/pdf', '.pdf')).toBe(true)
    expect(attachmentMimeMatchesExtension('application/acad', '.dwg')).toBe(true)
    expect(attachmentMimeMatchesExtension('application/x-autocad', '.dwg')).toBe(true)
    expect(attachmentMimeMatchesExtension('application/dxf', '.dxf')).toBe(true)
    expect(attachmentMimeMatchesExtension('application/step', '.step')).toBe(true)
    expect(attachmentMimeMatchesExtension('model/step', '.stp')).toBe(true)
    expect(attachmentMimeMatchesExtension('model/3dm', '.3dm')).toBe(true)
    expect(attachmentMimeMatchesExtension('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx')).toBe(true)
    expect(attachmentMimeMatchesExtension('application/vnd.ms-excel', '.xls')).toBe(true)
    expect(attachmentMimeMatchesExtension('text/csv', '.csv')).toBe(true)
    expect(attachmentMimeMatchesExtension('application/zip', '.zip')).toBe(true)
    expect(attachmentMimeMatchesExtension('image/jpeg', '.jpg')).toBe(true)
    expect(attachmentMimeMatchesExtension('image/png', '.png')).toBe(true)

    // Mismatched MIME
    expect(attachmentMimeMatchesExtension('application/pdf', '.dwg')).toBe(false)
    expect(attachmentMimeMatchesExtension('image/png', '.pdf')).toBe(false)
    expect(attachmentMimeMatchesExtension('text/plain', '.exe')).toBe(false)
  })

  it('verifies magic bytes for binary technical formats and images', () => {
    // PDF
    const pdfBytes = Buffer.from('%PDF-1.7\n%...')
    expect(attachmentBytesMatch(pdfBytes, '.pdf')).toBe(true)

    // DWG
    const dwgBytes = Buffer.from('AC1032\x00\x00\x00')
    expect(attachmentBytesMatch(dwgBytes, '.dwg')).toBe(true)

    // STEP
    const stepBytes = Buffer.from('ISO-10303-21;\nHEADER;\n')
    expect(attachmentBytesMatch(stepBytes, '.step')).toBe(true)
    expect(attachmentBytesMatch(stepBytes, '.stp')).toBe(true)

    // ZIP & XLSX
    const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
    expect(attachmentBytesMatch(zipBytes, '.zip')).toBe(true)
    expect(attachmentBytesMatch(zipBytes, '.xlsx')).toBe(true)

    // PNG
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(attachmentBytesMatch(pngBytes, '.png')).toBe(true)

    // JPEG
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(attachmentBytesMatch(jpegBytes, '.jpg')).toBe(true)
    expect(attachmentBytesMatch(jpegBytes, '.jpeg')).toBe(true)

    // 3DM / XLS
    const cfbBytes = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(attachmentBytesMatch(cfbBytes, '.3dm')).toBe(true)
    expect(attachmentBytesMatch(cfbBytes, '.xls')).toBe(true)

    // CSV text
    const csvBytes = Buffer.from('Item,Quantity,Unit\nPanel,1200,sqm\n')
    expect(attachmentBytesMatch(csvBytes, '.csv')).toBe(true)

    // Rejects executables even if named .pdf or .dwg
    const exeBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]) // MZ header
    expect(attachmentBytesMatch(exeBytes, '.pdf')).toBe(false)
    expect(attachmentBytesMatch(exeBytes, '.dwg')).toBe(false)

    const elfBytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]) // ELF header
    expect(attachmentBytesMatch(elfBytes, '.step')).toBe(false)
  })

  it('calculates sha256 checksum correctly', () => {
    const data = Buffer.from('IVYBM Attachment Data')
    expect(attachmentSha256(data)).toHaveLength(64)
  })

  it('safely resolves storage path and blocks traversal', async () => {
    const safe = await resolveManagedLeadAttachmentPath('test-drawing.dwg')
    expect(safe).toContain('private/lead-attachments/test-drawing.dwg')

    await expect(resolveManagedLeadAttachmentPath('../etc/passwd')).rejects.toThrow()
    await expect(resolveManagedLeadAttachmentPath('folder/file.pdf')).rejects.toThrow()
    await expect(resolveManagedLeadAttachmentPath('')).rejects.toThrow()
  })
})
