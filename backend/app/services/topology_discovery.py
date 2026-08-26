"""Topology discovery service — discovers network neighbors via CDP/LLDP."""

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from pysnmp.hlapi.v3arch.asyncio import (
        CommunityData,
        ContextData,
        ObjectIdentity,
        ObjectType,
        SnmpEngine,
        UdpTransportTarget,
        next_cmd,
    )
    SNMP_AVAILABLE = True
except ImportError:
    SNMP_AVAILABLE = False

from ..models.device import Device
from ..models.topology import TopologyEdge, TopologyNode


class TopologyDiscovery:
    """Discovers network topology using CDP and LLDP via SNMP."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def run_discovery(self) -> None:
        """Run full topology discovery on all SNMP-enabled devices."""
        if not SNMP_AVAILABLE:
            logger.warning("Topology discovery skipped — pysnmp not installed")
            return

        result = await self.session.execute(
            select(Device).where(Device.snmp_enabled.is_(True))
        )
        devices = result.scalars().all()

        for device in devices:
            try:
                await self._discover_device(device)
            except Exception as e:
                logger.error(f"Topology discovery failed for {device.name}: {e}")

        await self.session.commit()
        logger.info("Topology discovery completed")

    async def _discover_device(self, device: Device) -> None:
        """Discover neighbors of a single device."""
        # Ensure the device has a topology node
        node = await self._get_or_create_node(device)

        # Try CDP first
        cdp_neighbors = await self._discover_cdp(
            device.ip_address, device.snmp_community or "public"
        )
        if cdp_neighbors:
            await self._process_neighbors(node, cdp_neighbors, "cdp")

        # Try LLDP
        lldp_neighbors = await self._discover_lldp(
            device.ip_address, device.snmp_community or "public"
        )
        if lldp_neighbors:
            await self._process_neighbors(node, lldp_neighbors, "lldp")

    async def _get_or_create_node(self, device: Device) -> TopologyNode:
        """Get or create a topology node for a device."""
        result = await self.session.execute(
            select(TopologyNode).where(
                TopologyNode.device_id == device.id,
                TopologyNode.node_type == "device",
            )
        )
        node = result.scalar_one_or_none()

        if not node:
            # Auto-layout: simple grid placement
            count_result = await self.session.execute(
                select(TopologyNode)
            )
            count = len(count_result.scalars().all())
            col = count % 5
            row = count // 5

            node = TopologyNode(
                device_id=device.id,
                label=device.name,
                node_type="device",
                x=col * 200 + 100,
                y=row * 150 + 100,
                discovery_source="manual",  # Initially manual, CDP/LLDP edges will be auto
            )
            self.session.add(node)
            await self.session.flush()

        return node

    async def _discover_cdp(self, ip: str, community: str) -> list[dict]:
        """Discover CDP neighbors."""
        neighbors = []
        try:
            iterator = next_cmd(
                SnmpEngine(),
                CommunityData(community, mpModel=1),
                await UdpTransportTarget.create((ip, 161), timeout=2, retries=1),
                ContextData(),
                ObjectType(ObjectIdentity("1.3.6.1.4.1.9.9.23.1.2.1.1.6")),  # cdpCacheDeviceId
                lexicographicMode=False,
            )

            while True:
                try:
                    error_indication, error_status, error_index, var_binds = await iterator
                    if error_indication:
                        break
                    for vb in var_binds:
                        # Try to resolve neighbor name to IP
                        neighbor_name = str(vb[1])
                        neighbors.append({
                            "neighbor_name": neighbor_name,
                            "local_interface": None,
                            "neighbor_interface": None,
                        })
                except StopIteration:
                    break
                except Exception:
                    break
        except Exception as e:
            logger.debug(f"CDP discovery failed for {ip}: {e}")

        return neighbors

    async def _discover_lldp(self, ip: str, community: str) -> list[dict]:
        """Discover LLDP neighbors."""
        neighbors = []
        try:
            iterator = next_cmd(
                SnmpEngine(),
                CommunityData(community, mpModel=1),
                await UdpTransportTarget.create((ip, 161), timeout=2, retries=1),
                ContextData(),
                ObjectType(ObjectIdentity("1.0.8802.1.1.2.1.4.1.1.9")),  # lldpRemSysName
                lexicographicMode=False,
            )

            while True:
                try:
                    error_indication, error_status, error_index, var_binds = await iterator
                    if error_indication:
                        break
                    for vb in var_binds:
                        neighbors.append({
                            "neighbor_name": str(vb[1]),
                            "local_interface": None,
                            "neighbor_interface": None,
                        })
                except StopIteration:
                    break
                except Exception:
                    break
        except Exception as e:
            logger.debug(f"LLDP discovery failed for {ip}: {e}")

        return neighbors

    async def _process_neighbors(
        self, source_node: TopologyNode,
        neighbors: list[dict], protocol: str
    ) -> None:
        """Process discovered neighbors and create topology edges."""
        for neighbor in neighbors:
            neighbor_name = neighbor.get("neighbor_name")
            if not neighbor_name:
                continue

            # Try to find the neighbor device
            result = await self.session.execute(
                select(Device).where(
                    (Device.name == neighbor_name) |
                    (Device.hostname == neighbor_name)
                )
            )
            target_device = result.scalar_one_or_none()
            if not target_device:
                continue

            # Get or create target node
            target_result = await self.session.execute(
                select(TopologyNode).where(
                    TopologyNode.device_id == target_device.id,
                    TopologyNode.node_type == "device",
                )
            )
            target_node = target_result.scalar_one_or_none()

            if not target_node:
                continue

            # Check if edge already exists
            existing = await self.session.execute(
                select(TopologyEdge).where(
                    ((TopologyEdge.source_node_id == source_node.id) &
                     (TopologyEdge.target_node_id == target_node.id)) |
                    ((TopologyEdge.source_node_id == target_node.id) &
                     (TopologyEdge.target_node_id == source_node.id))
                )
            )
            if existing.scalar_one_or_none():
                continue

            # Create auto-discovered edge (only if no manual edge exists)
            existing_manual = await self.session.execute(
                select(TopologyEdge).where(
                    ((TopologyEdge.source_node_id == source_node.id) &
                     (TopologyEdge.target_node_id == target_node.id) &
                     (TopologyEdge.discovery_source == "manual")) |
                    ((TopologyEdge.source_node_id == target_node.id) &
                     (TopologyEdge.target_node_id == source_node.id) &
                     (TopologyEdge.discovery_source == "manual"))
                )
            )
            if existing_manual.scalar_one_or_none():
                continue  # Manual edge takes priority

            edge = TopologyEdge(
                source_node_id=source_node.id,
                target_node_id=target_node.id,
                label=f"{protocol.upper()} link",
                edge_type="wired",
                discovery_source=protocol,
                source_interface=neighbor.get("local_interface"),
                target_interface=neighbor.get("neighbor_interface"),
            )
            self.session.add(edge)
