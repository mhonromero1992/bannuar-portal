/**
 * Guards have no company email, so each app login uses an address made from the employee number.
 * The .invalid top-level domain is reserved (RFC 2606) and can never receive mail; nothing is ever
 * sent to it. The app makes the same address at sign-in (bannuar-app src/services/loginEmail.ts): keep
 * the two in step, and set the same domain on both if Bannuar picks one of its own.
 */
export const DEFAULT_LOGIN_DOMAIN = 'employees.bannuar.invalid';

/**
 * "G-001" -> "g-001@employees.bannuar.invalid". Letters, digits and "-" stay; every other character
 * becomes "_" and its four-digit hex code, so two employee numbers never share a login.
 * The database stores employee numbers trimmed and in capitals; this follows it.
 */
export function loginEmail(employeeNo: string, domain: string = DEFAULT_LOGIN_DOMAIN): string {
  const no = employeeNo.trim().toUpperCase().toLowerCase();
  let local = '';
  for (let i = 0; i < no.length; i++) {
    const ch = no[i];
    local += /[a-z0-9-]/.test(ch) ? ch : `_${no.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  return `${local}@${domain}`;
}

/** An email address keeps at most 64 characters before the @. */
export function loginEmailFits(employeeNo: string): boolean {
  const email = loginEmail(employeeNo, 'x');
  return email.length - 2 <= 64 && email.length > 2;
}
