export type DocumentOutputFormat = 'pdf';

export type ConversionAvailability = 'browser' | 'server' | 'unsupported';

export interface DocumentFormatOption {
  id: string;
  label: string;
  extensions: string[];
  outputFormats: DocumentOutputFormat[];
  availability: ConversionAvailability;
  statusMessage: string;
}

export const DOCUMENT_FORMAT_OPTIONS: DocumentFormatOption[] = [
  {
    id: 'word',
    label: 'Word (DOC, DOCX)',
    extensions: ['doc', 'docx'],
    outputFormats: ['pdf'],
    availability: 'server',
    statusMessage: 'Word to PDF conversion will require server-side processing in a future release.'
  },
  {
    id: 'powerpoint',
    label: 'PowerPoint (PPT, PPTX)',
    extensions: ['ppt', 'pptx'],
    outputFormats: ['pdf'],
    availability: 'server',
    statusMessage: 'PowerPoint to PDF conversion will require server-side processing in a future release.'
  },
  {
    id: 'excel',
    label: 'Excel (XLS, XLSX)',
    extensions: ['xls', 'xlsx'],
    outputFormats: ['pdf'],
    availability: 'server',
    statusMessage: 'Excel to PDF conversion will require server-side processing in a future release.'
  },
  {
    id: 'publisher',
    label: 'Publisher (PUB)',
    extensions: ['pub'],
    outputFormats: ['pdf'],
    availability: 'server',
    statusMessage: 'Publisher to PDF conversion is planned as a server-powered workflow.'
  }
];

const extensionLookup = new Map<string, DocumentFormatOption>();
DOCUMENT_FORMAT_OPTIONS.forEach((option) => {
  option.extensions.forEach((ext) => extensionLookup.set(ext, option));
});

export const SUPPORTED_DOCUMENT_PICKER_TYPES =
  '.doc,.docx,.ppt,.pptx,.xls,.xlsx,.pub,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function getDocumentFormatByFileName(fileName: string): DocumentFormatOption | undefined {
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : '';
  return extensionLookup.get(ext);
}
