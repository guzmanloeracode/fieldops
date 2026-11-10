export function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-xs">
      {message}
    </p>
  );
}
