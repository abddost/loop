/**
 * SearchInput -- reusable debounced search bar for the settings modal.
 *
 * Uses the SDK Input with startAdornment/endAdornment for a polished look.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@openai/apps-sdk-ui/components/Input';
import { Search, X } from '@openai/apps-sdk-ui/components/Icon';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
}: SearchInputProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync external value changes
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setLocal(next);

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onChange(next);
    }, 150);
  };

  const handleClear = useCallback(() => {
    setLocal('');
    onChange('');
  }, [onChange]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <Input
      type="text"
      value={local}
      onChange={handleChange}
      placeholder={placeholder}
      variant="soft"
      size="sm"
      startAdornment={
        <Search className="size-3.5 text-tertiary" />
      }
      endAdornment={
        local ? (
          <button
            onClick={handleClear}
            className="p-0.5 rounded text-tertiary hover:text-secondary transition-colors cursor-pointer"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        ) : null
      }
    />
  );
}
