export function MeaningList({ meanings, className }: { meanings: string[]; className?: string }) {
  if (meanings.length === 0) {
    return null;
  }

  if (meanings.length === 1) {
    return <span className={className ? `prompt-meta ${className}` : 'prompt-meta'}>{meanings[0]}</span>;
  }

  return (
    <ul className={className ? `meaning-list ${className}` : 'meaning-list'}>
      {meanings.map((meaning, index) => (
        <li key={`${index}-${meaning}`}>{meaning}</li>
      ))}
    </ul>
  );
}
