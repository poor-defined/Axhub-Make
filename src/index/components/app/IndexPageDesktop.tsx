import React from 'react';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import NewSidebar from '../sidebar/NewSidebar';
import { ResponsiveSidebarProvider } from '../sidebar/ResponsiveSidebarController';
import PresentationArea from '../content/PresentationArea';
import AssistantPanel from './AssistantPanel';
import type { AssistantIframeRenderEntry } from './AssistantPanel';
import type {
    NewSidebarGroupedProps,
    PresentationAreaGroupedProps,
} from '../../types/index-page.types';
import type { AcpContextItem } from '../../domains/assistant/assistantAcpContext';
import {
    resolveResponsiveSidebarDefaultCollapsed,
    resolveResponsiveWorkspaceAvailableWidth,
} from '../sidebar/responsiveSidebarState';

interface IndexPageDesktopProps {
    referenceWorkspace?: { active: boolean; onActiveChange: (active: boolean) => void; panel: React.ReactNode; view: React.ReactNode };
    sidebarProps: NewSidebarGroupedProps;
    presentationAreaProps: PresentationAreaGroupedProps;
    assistantPanel: {
        mounted: boolean;
        visible: boolean;
        width: number;
        minWidth: number;
        maxWidth: number;
        iframeEntries: AssistantIframeRenderEntry[];
        activeIframeKey: string | null;
        onIframeRef: (key: string, iframe: HTMLIFrameElement | null) => void;
        onIframeLoad: (key: string) => void;
        onResize: (width: number) => void;
        onAddContextItems: (items: AcpContextItem[]) => boolean | Promise<boolean>;
        onToggle: () => void;
    };
    responsiveSidebar: {
        defaultCollapsed: boolean;
        onDefaultCollapsedChange: (collapsed: boolean) => void;
    };
    workspaceMetrics: {
        onExternalAvailableWidthChange: (width: number) => void;
    };
}

export default function IndexPageDesktop({
    sidebarProps,
    presentationAreaProps,
    assistantPanel,
    responsiveSidebar,
    workspaceMetrics,
    referenceWorkspace,
}: IndexPageDesktopProps) {
    const workspaceRef = React.useRef<HTMLDivElement | null>(null);
    const lastResponsiveSidebarDefaultRef = React.useRef(responsiveSidebar.defaultCollapsed);
    const initialWorkspaceLoading = sidebarProps.state.loading && ![
        presentationAreaProps.state.selectedItem, presentationAreaProps.state.selectedDoc,
        presentationAreaProps.state.selectedTheme, presentationAreaProps.state.selectedCanvas,
        presentationAreaProps.state.selectedTemplate, presentationAreaProps.state.selectedDataTable,
    ].some(Boolean);

    React.useEffect(() => {
        const workspace = workspaceRef.current;
        if (!workspace) return;

        const updateWorkspaceMeasurements = () => {
            const measurement = {
                workspaceWidth: workspaceRef.current ? workspaceRef.current.clientWidth : 0,
                assistantVisible: assistantPanel.visible,
                assistantWidth: assistantPanel.width,
            };
            const externalAvailableWidth = resolveResponsiveWorkspaceAvailableWidth(measurement);
            workspaceMetrics.onExternalAvailableWidthChange(externalAvailableWidth);

            const nextCollapsed = resolveResponsiveSidebarDefaultCollapsed(measurement);
            if (nextCollapsed === lastResponsiveSidebarDefaultRef.current) return;
            lastResponsiveSidebarDefaultRef.current = nextCollapsed;
            responsiveSidebar.onDefaultCollapsedChange(nextCollapsed);
        };

        updateWorkspaceMeasurements();
        const observer = new ResizeObserver(updateWorkspaceMeasurements);
        observer.observe(workspace);
        return () => observer.disconnect();
    }, [
        assistantPanel.visible,
        assistantPanel.width,
        responsiveSidebar.onDefaultCollapsedChange,
        workspaceMetrics.onExternalAvailableWidthChange,
    ]);

    return (
        <ResponsiveSidebarProvider>
            <div className="pc-layout">
                <div ref={workspaceRef} style={{ display: 'flex', height: '100vh', minHeight: 0 }}>
                    <NewSidebar {...sidebarProps} referenceActive={referenceWorkspace?.active} onReferenceActiveChange={referenceWorkspace?.onActiveChange} referencePanel={referenceWorkspace?.panel} />

                    <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                        {referenceWorkspace?.active ? referenceWorkspace.view : initialWorkspaceLoading ? <div className="min-w-0 flex-1 bg-background"><PageSkeleton label="正在加载项目" /></div> : <PresentationArea {...presentationAreaProps} />}

                        {assistantPanel.mounted ? (
                            <AssistantPanel
                                mounted={assistantPanel.mounted}
                                visible={assistantPanel.visible}
                                width={assistantPanel.width}
                                minWidth={assistantPanel.minWidth}
                                maxWidth={assistantPanel.maxWidth}
                                iframeEntries={assistantPanel.iframeEntries}
                                activeIframeKey={assistantPanel.activeIframeKey}
                                onIframeRef={assistantPanel.onIframeRef}
                                onIframeLoad={assistantPanel.onIframeLoad}
                                onResize={assistantPanel.onResize}
                                onAddContextItems={assistantPanel.onAddContextItems}
                                onToggle={assistantPanel.onToggle}
                            />
                        ) : null}
                    </div>
                </div>
            </div>
        </ResponsiveSidebarProvider>
    );
}
