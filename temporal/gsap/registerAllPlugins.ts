import gsap from "gsap";
import CSSPlugin from "gsap/CSSPlugin";
import CSSRulePlugin from "gsap/CSSRulePlugin";
import CustomBounce from "gsap/CustomBounce";
import CustomEase from "gsap/CustomEase";
import CustomWiggle from "gsap/CustomWiggle";
import Draggable from "gsap/Draggable";
import DrawSVGPlugin from "gsap/DrawSVGPlugin";
import EaselPlugin from "gsap/EaselPlugin";
import Flip from "gsap/Flip";
import GSDevTools from "gsap/GSDevTools";
import InertiaPlugin from "gsap/InertiaPlugin";
import MorphSVGPlugin from "gsap/MorphSVGPlugin";
import MotionPathHelper from "gsap/MotionPathHelper";
import MotionPathPlugin from "gsap/MotionPathPlugin";
import Observer from "gsap/Observer";
import Physics2DPlugin from "gsap/Physics2DPlugin";
import PhysicsPropsPlugin from "gsap/PhysicsPropsPlugin";
import PixiPlugin from "gsap/PixiPlugin";
import ScrambleTextPlugin from "gsap/ScrambleTextPlugin";
import ScrollSmoother from "gsap/ScrollSmoother";
import ScrollToPlugin from "gsap/ScrollToPlugin";
import ScrollTrigger from "gsap/ScrollTrigger";
import SplitText from "gsap/SplitText";
import TextPlugin from "gsap/TextPlugin";

let registered = false;

export function registerAllGsapPlugins(): typeof gsap {
  if (registered) {
    return gsap;
  }

  gsap.registerPlugin(
    CSSPlugin,
    CSSRulePlugin,
    CustomBounce,
    CustomEase,
    CustomWiggle,
    Draggable,
    DrawSVGPlugin,
    EaselPlugin,
    Flip,
    GSDevTools,
    InertiaPlugin,
    MorphSVGPlugin,
    MotionPathHelper,
    MotionPathPlugin,
    Observer,
    Physics2DPlugin,
    PhysicsPropsPlugin,
    PixiPlugin,
    ScrambleTextPlugin,
    ScrollSmoother,
    ScrollToPlugin,
    ScrollTrigger,
    SplitText,
    TextPlugin,
  );

  registered = true;
  return gsap;
}

export { gsap };