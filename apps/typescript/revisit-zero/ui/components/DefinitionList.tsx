interface DefinitionItem {
  term: string;
  description: React.ReactNode;
}

interface DefinitionListProps {
  items: DefinitionItem[];
  compact?: boolean;
}

export function DefinitionList({ items, compact = false }: DefinitionListProps) {
  return (
    <dl className={compact ? "definition-list definition-list--compact" : "definition-list"}>
      {items.map((item) => (
        <div className="definition-list__row" key={item.term}>
          <dt>{item.term}</dt>
          <dd>{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
