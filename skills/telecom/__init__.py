"""
AVA007 Telecom Skill — Double Learning Intelligence (DLI)

Telecom is a SKILL (not a subsystem). It deploys to harnesses:
  - termux_usb_serial (modem AT commands, identity rotation)
  - gsap_temporal (record rotation + detection events)
  - neo4j_graphrag (lookup known IMSI catchers)
  - mellum2 (classify RF patterns)

Implements the DLI intelligence report:
  1. JCAS Fusion Kernel (paging attack defense, signaling firewall)
  2. Identity Rotation (IMSI/IMEI rotation synced with sensing pulses)
  3. Ephemeral Log Policy (24-hour semantic data minimization)
  4. Backhaul Steering (E-band mmWave + Microwave IP)
  5. DLI training (Double DQN + Lyapunov drift-plus-penalty)
"""

from .jcas import JCASFusionKernel, PagingAttackDefense, SignalingFirewall
from .identity_rotation import IdentityRotationController
from .ephemeral_log import EphemeralLogPolicy
from .backhaul import BackhaulSteeringController
from .dli_config import DLI_CONFIG

__all__ = [
    'JCASFusionKernel',
    'PagingAttackDefense',
    'SignalingFirewall',
    'IdentityRotationController',
    'EphemeralLogPolicy',
    'BackhaulSteeringController',
    'DLI_CONFIG',
]

# Skill manifest — declares which harnesses this skill deploys to
SKILL_MANIFEST = {
    'name': 'telecom',
    'version': 1,
    'description': 'Double Learning Intelligence for sovereign telecom operation',
    'harnesses': [
        'termux_usb_serial',   # modem AT commands
        'gsap_temporal',       # event recording
        'neo4j_graphrag',      # catcher lookup
        'mellum2',             # RF pattern classification
        'lora_sx1262',         # sub-GHz mesh (when available)
    ],
    'capabilities': [
        'telecom.detect_imsi_catcher',
        'telecom.rotate_identity',
        'telecom.steer_backhaul',
        'telecom.purge_logs',
        'telecom.train_dli',
    ],
}
