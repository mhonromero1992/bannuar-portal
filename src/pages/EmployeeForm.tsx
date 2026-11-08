import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText } from '../lib/format';
import { EMPLOYEE_STATUS, EMPLOYMENT_TYPE, options } from '../lib/labels';
import { useAreas, useSites } from '../lib/refs';
import { SelectField, TextArea, TextField, useToast } from '../ui/kit';

export interface EmployeeRow {
  id: string; user_id: string | null; employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null;
  birthdate: string | null; sex: string | null; civil_status: string | null; mobile_no: string | null; email: string | null;
  present_address: string | null; provincial_address: string | null; position: string; is_field: boolean; employment_type: string; status: string;
  date_hired: string | null; date_regularized: string | null; date_separated: string | null; separation_reason: string | null;
  area_id: string | null; site_id: string | null; floating_since: string | null; emergency_contact_name: string | null;
  emergency_contact_relation: string | null; emergency_contact_phone: string | null; notes: string | null;
}

const FIELDS = ['employee_no', 'first_name', 'middle_name', 'last_name', 'suffix', 'birthdate', 'sex', 'civil_status', 'mobile_no', 'email',
  'present_address', 'provincial_address', 'position', 'employment_type', 'status', 'date_hired', 'date_regularized', 'date_separated',
  'separation_reason', 'area_id', 'site_id', 'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone', 'notes'] as const;

type Values = Record<(typeof FIELDS)[number], string> & { is_field: boolean };

const blank = (): Values => ({
  ...(Object.fromEntries(FIELDS.map((f) => [f, ''])) as Record<(typeof FIELDS)[number], string>),
  position: 'Security Guard', employment_type: 'probationary', status: 'active', is_field: true,
});

export function EmployeeForm({ employee, onSaved, onCancel }: { employee?: EmployeeRow; onSaved: (id: string) => void; onCancel: () => void }) {
  const [v, setV] = useState<Values>(() => {
    if (!employee) return blank();
    const out = blank();
    for (const f of FIELDS) out[f] = (employee[f] as string | null) ?? '';
    out.is_field = employee.is_field;
    return out;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const areas = useAreas();
  const sites = useSites();
  const qc = useQueryClient();
  const toast = useToast();
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const errs: Record<string, string> = {};
    if (!v.employee_no.trim()) errs.employee_no = 'Enter the employee number.';
    if (!v.first_name.trim()) errs.first_name = 'Enter the first name.';
    if (!v.last_name.trim()) errs.last_name = 'Enter the last name.';
    if (!v.position.trim()) errs.position = 'Enter the position.';
    if (v.mobile_no && !/^(?:\+?63|0)?9\d{9}$/.test(v.mobile_no.replace(/[^\d+]/g, ''))) errs.mobile_no = 'Use a mobile number like 0917 123 4567.';
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errs.email = 'Enter a valid email address.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const row: Record<string, unknown> = { is_field: v.is_field };
    for (const f of FIELDS) row[f] = v[f].trim() === '' ? null : v[f].trim();
    setBusy(true);
    const res = employee
      ? await supabase.from('employees').update(row).eq('id', employee.id).select('id').single()
      : await supabase.from('employees').insert(row).select('id').single();
    setBusy(false);
    if (res.error) return setError(res.error.code === '23505' ? 'Another employee already has this employee number.' : errorText(res.error));
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['employee', res.data.id] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast(employee ? 'Saved.' : 'Employee added.');
    onSaved(res.data.id);
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-row">
        <TextField label="Employee number" value={v.employee_no} onChange={set('employee_no')} error={errors.employee_no} />
        <TextField label="Position" value={v.position} onChange={set('position')} error={errors.position} />
        <SelectField label="Employment" value={v.employment_type} onChange={set('employment_type')} options={options(EMPLOYMENT_TYPE)} />
      </div>
      <div className="form-row">
        <TextField label="First name" value={v.first_name} onChange={set('first_name')} error={errors.first_name} />
        <TextField label="Middle name" optional value={v.middle_name} onChange={set('middle_name')} />
        <TextField label="Last name" value={v.last_name} onChange={set('last_name')} error={errors.last_name} />
        <TextField label="Suffix" optional value={v.suffix} onChange={set('suffix')} placeholder="Jr., III" />
      </div>
      <div className="form-row">
        <TextField label="Birthday" optional type="date" value={v.birthdate} onChange={set('birthdate')} hint="Needed for the employee to activate the app." />
        <SelectField label="Sex" optional value={v.sex} onChange={set('sex')} placeholder="Not set" options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
        <SelectField label="Civil status" optional value={v.civil_status} onChange={set('civil_status')} placeholder="Not set" options={['single', 'married', 'widowed', 'separated', 'annulled'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
      </div>
      <div className="form-row">
        <TextField label="Mobile number" optional value={v.mobile_no} onChange={set('mobile_no')} error={errors.mobile_no} hint="Needed for the app too." />
        <TextField label="Email" optional type="email" value={v.email} onChange={set('email')} error={errors.email} />
      </div>
      <div className="form-row">
        <TextField label="Present address" optional value={v.present_address} onChange={set('present_address')} />
        <TextField label="Provincial address" optional value={v.provincial_address} onChange={set('provincial_address')} />
      </div>
      <div className="form-row">
        <SelectField label="Status" value={v.status} onChange={set('status')} options={options(EMPLOYEE_STATUS)} />
        <SelectField label="Area" optional value={v.area_id} onChange={set('area_id')} placeholder="None" options={(areas.data ?? []).map((a) => ({ value: a.id, label: a.name }))} />
        <SelectField label="Post" optional value={v.site_id} onChange={set('site_id')} placeholder="None" options={(sites.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: s.name }))} hint="Floating status clears the post." />
      </div>
      <label className="check"><input type="checkbox" checked={v.is_field} onChange={(e) => setV({ ...v, is_field: e.target.checked })} /> Field personnel (guards, commanders, inspectors): licenses and clearances are checked for deployment</label>
      <div className="form-row">
        <TextField label="Date hired" optional type="date" value={v.date_hired} onChange={set('date_hired')} />
        <TextField label="Regularized" optional type="date" value={v.date_regularized} onChange={set('date_regularized')} />
        <TextField label="Separated" optional type="date" value={v.date_separated} onChange={set('date_separated')} />
      </div>
      {['resigned', 'terminated', 'end_of_contract', 'retired'].includes(v.status) && (
        <TextField label="Reason for separation" optional value={v.separation_reason} onChange={set('separation_reason')} />
      )}
      <div className="form-row">
        <TextField label="Emergency contact" optional value={v.emergency_contact_name} onChange={set('emergency_contact_name')} />
        <TextField label="Relation" optional value={v.emergency_contact_relation} onChange={set('emergency_contact_relation')} />
        <TextField label="Contact number" optional value={v.emergency_contact_phone} onChange={set('emergency_contact_phone')} />
      </div>
      <TextArea label="Notes" optional value={v.notes} onChange={set('notes')} rows={3} />
      <div className="form-foot">
        <button className="btn btn-line" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn" type="submit" aria-busy={busy}>{employee ? 'Save changes' : 'Add employee'}</button>
      </div>
    </form>
  );
}
