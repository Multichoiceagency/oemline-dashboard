import React from 'react';
import type {ReactNode} from 'react';

export default function Root({children}: {children: ReactNode}): ReactNode {
  return (
    <>
      {children}
      {/* Google Translate element — the init script populates this div */}
      <div
        id="google_translate_element"
        style={{display: 'none'}}
      />
    </>
  );
}
