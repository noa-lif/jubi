import { redirect } from 'next/navigation'

// Port of App.jsx's catch-all route: <Route path="*" element={<Navigate to="/auth" replace />} />
export default function NotFound() {
  redirect('/auth')
}
