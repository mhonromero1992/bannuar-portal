import { Link } from 'react-router';
import { Empty } from '../ui/kit';

export default function NotFound() {
  return (
    <Empty title="This page is not on the roster">
      <Link className="btn btn-line" to="/">Go to the dashboard</Link>
    </Empty>
  );
}
