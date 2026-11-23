declare module "react-leaflet-draw" {
  import { Control } from "leaflet";
  import { FC } from "react";

  interface EditControlProps {
    position?: Control.ControlPosition;
    onCreated?: (e: any) => void;
    onEdited?: (e: any) => void;
    onDeleted?: (e: any) => void;
    onMounted?: (e: any) => void;
    onEditStart?: (e: any) => void;
    onEditStop?: (e: any) => void;
    onDeleteStart?: (e: any) => void;
    onDeleteStop?: (e: any) => void;
    onDrawStart?: (e: any) => void;
    onDrawStop?: (e: any) => void;
    onDrawVertex?: (e: any) => void;
    onEditMove?: (e: any) => void;
    onEditResize?: (e: any) => void;
    onEditVertex?: (e: any) => void;
    draw?: any;
    edit?: any;
  }

  export const EditControl: FC<EditControlProps>;
}
