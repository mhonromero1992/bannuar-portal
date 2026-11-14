// The file picker in the showcase: a demo medical certificate (PDF)
export const types = { pdf: 'application/pdf', images: 'image/*', allFiles: '*/*' };
export async function pick() {
  return [{ uri: 'data:application/pdf;base64,JVBERi0xLjQK', name: 'medical-certificate.pdf', type: 'application/pdf', size: 214000, error: null, isVirtual: false, convertibleToMimeTypes: null, hasRequestedType: true, nativeType: 'application/pdf' }];
}
export async function keepLocalCopy({ files }) { return files.map((f) => ({ status: 'success', localUri: f.uri, sourceUri: f.uri })); }
export const isErrorWithCode = () => false;
export const errorCodes = { OPERATION_CANCELED: 'OPERATION_CANCELED' };
export default { pick, types, keepLocalCopy, isErrorWithCode, errorCodes };
