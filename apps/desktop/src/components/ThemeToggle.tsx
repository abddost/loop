/**
 * ThemeToggle -- switch between dark, light, and system theme modes.
 */

import { useState, useEffect } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Moon, Sun, Desktop } from '@openai/apps-sdk-ui/components/Icon';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import {
  type ThemePreference,
  getStoredThemePreference,
  setTheme,
} from '../lib/theme';

const THEMES: { id: ThemePreference; icon: typeof Moon; label: string }[] = [
  { id: 'light', icon: Sun, label: 'Light' },
  { id: 'dark', icon: Moon, label: 'Dark' },
  { id: 'system', icon: Desktop, label: 'System' },
];

export function ThemeToggle() {
  const [current, setCurrent] = useState<ThemePreference>(getStoredThemePreference);

  useEffect(() => {
    setTheme(current);
  }, [current]);

  return (
    <div className="flex items-center rounded-lg border border-subtle p-0.5 gap-0.5">
      {THEMES.map(({ id, icon: Icon, label }) => (
        <Tooltip key={id} content={label}>
          <Button
            variant={current === id ? 'soft' : 'ghost'}
            color="secondary"
            size="sm"
            onClick={() => setCurrent(id)}
            className="px-2! py-1!"
          >
            <Icon className="size-3.5" />
          </Button>
        </Tooltip>
      ))}
    </div>
  );
}
