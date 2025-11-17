import { Button } from 'antd';

interface HeroCreateCardProps {
  onOpenAdvanced: () => void;
  buttonClassName?: string;
}

export function HeroCreateCard({
  onOpenAdvanced,
  buttonClassName,
}: HeroCreateCardProps) {
  return (
    <Button
      type="primary"
      onClick={onOpenAdvanced}
      size="large"
      className={buttonClassName}
    >
      立即创建投资组合
    </Button>
  );
}
