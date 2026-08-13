import { Icon, type IconName } from './Icon';

export function EmptyState({
  icon = 'music',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return <section className="empty-state-panel" role="status">
    <span className="empty-state-panel__icon" aria-hidden="true"><Icon name={icon} size={25} /></span>
    <span><strong>{title}</strong>{description && <small>{description}</small>}</span>
    {action && <div className="empty-state-panel__action">{action}</div>}
  </section>;
}
