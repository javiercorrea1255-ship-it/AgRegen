declare module "@google/earthengine" {
  namespace ee {
    function initialize(
      baseurl: string | null,
      tileurl: string | null,
      callback: () => void,
      errorCallback?: (error: Error) => void
    ): void;

    namespace data {
      function authenticateViaPrivateKey(
        key: object | string,
        callback: () => void,
        errorCallback?: (error: Error) => void
      ): void;
    }

    function Geometry(): any;
    namespace Geometry {
      function Polygon(coords: number[][][]): any;
      function Rectangle(coords: any, projection?: any, geodesic?: boolean): any;
      function Point(coords: number[]): any;
    }

    function ImageCollection(collectionId: string): any;
    function Image(imageId?: any): any;
    namespace Image {
      function constant(value: number): any;
    }
    function Feature(geometry: any, properties?: Record<string, any>): any;
    function Number(value: any): any;
    function List(values: any): any;
    namespace List {
      function sequence(start: number, end: number): any;
    }
    function Dictionary(values: Record<string, any>): any;
    function Date(value: any): any;
    namespace Algorithms {
      function If(condition: any, whenTrue: any, whenFalse: any): any;
    }
    function FeatureCollection(features: any[]): any;
    function Filter(): any;
    namespace Filter {
      function lt(property: string, value: number): any;
      function eq(property: string, value: any): any;
      function gte(property: string, value: any): any;
      function inList(property: string, values: any): any;
      function date(start: string, end: string): any;
      function bounds(geometry: any): any;
    }

    function Reducer(): any;
    namespace Reducer {
      function mean(): any;
      function min(): any;
      function max(): any;
      function count(): any;
      function minMax(): any;
      function toList(count: number): any;
    }
  }

  export = ee;
}
