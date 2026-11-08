import { PageSkeleton } from '../components/ui/page-skeleton';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Excalidraw } from '@axhub/excalidraw';
import '@axhub/excalidraw/index.css';

type ExcalidrawAPI = NonNullable<Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['onExcalidrawAPI']>>[0]>;

interface ExcalidrawCanvasProps {
    canvasName: string;
    isDarkMode: boolean;
}

const SAVE_DEBOUNCE_MS = 1500;

function encodeCanvasApiPath(canvasName: string): string {
    return canvasName
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

function resolveResourceCanvasApiPath(canvasName: string): string {
    const normalized = String(canvasName || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.startsWith('resources/')) {
        return normalized.slice('resources/'.length);
    }
    if (normalized.startsWith('src/resources/')) {
        return normalized.slice('src/resources/'.length);
    }
    return normalized;
}

function buildCanvasApiUrl(canvasName: string): string {
    return `/api/canvas/resources/${encodeCanvasApiPath(resolveResourceCanvasApiPath(canvasName))}`;
}

export default function ExcalidrawCanvas({ canvasName, isDarkMode }: ExcalidrawCanvasProps) {
    const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawAPI | null>(null);
    const [initialData, setInitialData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isSavingRef = useRef(false);
    const currentNameRef = useRef(canvasName);
    const hasLoadedRef = useRef(false);

    useEffect(() => {
        currentNameRef.current = canvasName;
        hasLoadedRef.current = false;
        setLoading(true);
        setError('');
        setInitialData(null);

        let cancelled = false;

        const loadCanvas = async () => {
            try {
                const response = await fetch(buildCanvasApiUrl(canvasName));
                if (cancelled) return;
                if (!response.ok) {
                    throw new Error(`加载画布失败 (${response.status})`);
                }

                const data = await response.json();
                if (cancelled) return;

                setInitialData(data);
                hasLoadedRef.current = true;
            } catch (err: any) {
                if (cancelled) return;
                setError(err?.message || '加载画布失败');
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadCanvas();
        return () => {
            cancelled = true;
        };
    }, [canvasName]);

    const saveCanvas = useCallback(async (elements: readonly any[], appState: any) => {
        if (isSavingRef.current) return;
        isSavingRef.current = true;

        try {
            const files = excalidrawAPI?.getFiles() || {};
            const payload = {
                type: 'excalidraw',
                version: 2,
                source: 'axhub-make',
                elements,
                appState: {
                    gridSize: appState?.gridSize ?? null,
                    viewBackgroundColor: appState?.viewBackgroundColor ?? '#ffffff',
                },
                files,
            };

            await fetch(buildCanvasApiUrl(currentNameRef.current), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: JSON.stringify(payload, null, 2) }),
            });
        } catch (err) {
            console.warn('Failed to save canvas:', err);
        } finally {
            isSavingRef.current = false;
        }
    }, [excalidrawAPI]);

    const handleChange = useCallback((elements: readonly any[], appState: any) => {
        if (!hasLoadedRef.current) return;

        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = setTimeout(() => {
            void saveCanvas(elements, appState);
        }, SAVE_DEBOUNCE_MS);
    }, [saveCanvas]);

    useEffect(() => {
        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
        };
    }, []);

    if (loading) {
        return <PageSkeleton variant="canvas" label="正在加载画布" />;
    }

    if (error) {
        return <div className="canvas-template-error">{error}</div>;
    }

    return (
        <div className="canvas-template-canvas">
            <Excalidraw
                key={canvasName}
                onExcalidrawAPI={(api: ExcalidrawAPI | null) => setExcalidrawAPI(api)}
                initialData={initialData}
                onChange={handleChange}
                theme={isDarkMode ? 'dark' : 'light'}
                UIOptions={{
                    canvasActions: {
                        saveAsImage: true,
                        export: false,
                    },
                }}
            />
        </div>
    );
}
