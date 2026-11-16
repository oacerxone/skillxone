import type { NavIcon as NavIconName } from '@/lib/navigation';
import {
  BookIcon,
  CodeIcon,
  CompassIcon,
  FlagIcon,
  FlameIcon,
  GitHubIcon,
  GridIcon,
  HeartIcon,
  InfoIcon,
  LayersIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UploadIcon,
} from './icons';

const ICONS: Record<NavIconName, (p: { className?: string; size?: number }) => React.ReactNode> = {
  compass: CompassIcon,
  grid: GridIcon,
  flame: FlameIcon,
  shield: ShieldCheckIcon,
  layers: LayersIcon,
  upload: UploadIcon,
  sparkles: SparklesIcon,
  book: BookIcon,
  code: CodeIcon,
  heart: HeartIcon,
  info: InfoIcon,
  flag: FlagIcon,
  github: GitHubIcon,
};

export function NavIcon({
  name,
  className,
  size,
}: {
  name: NavIconName;
  className?: string;
  size?: number;
}) {
  const Icon = ICONS[name];
  return <Icon className={className} size={size} />;
}
