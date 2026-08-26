/**
 * NMS i18n — Chinese / English
 */
window.I18N = {
    _lang: localStorage.getItem('nms_lang') || 'zh',

    DICT: {
        zh: {
            // Sidebar
            dashboard:'仪表盘',discovery:'设备发现',devices:'设备管理',
            topology:'网络拓扑',racks:'机柜视图',alerts:'告警中心',
            'add-device':'添加设备',add_device:'添加设备',add_device_desc:'手动添加网络设备或主机',
            'device-models':'设备型号',device_models_title:'设备型号管理',add_model:'添加型号',
            device_list:'设备列表',device_mgmt:'设备管理',category:'类别',settings:'设置',save:'保存',failed:'失败',settings_saved:'设置已保存',icmp_interval_label:'ICMP 检测间隔 (秒)',icmp_interval_hint:'对设备执行 ping 检测的频率',snmp_interval_label:'SNMP 采集间隔 (秒)',snmp_interval_hint:'对设备执行 SNMP 数据采集的频率',alert_interval_label:'告警检查间隔 (秒)',alert_interval_hint:'评估告警规则的频率',scan_concurrency_label:'扫描并发数',scan_concurrency_hint:'同时扫描多少个 IP',
            device_types_custom:'设备类型管理',add_type:'添加类型',no_custom_types:'暂无自定义类型',
            category_mgmt:'类别管理',add_category:'添加类别',
            import_csv:'导入CSV',export_csv:'导出CSV',
            import_btn:'导入',import_hint:'支持CSV和TXT格式',
            export_btn:'导出',export_hint:'导出为CSV或TXT格式',
            vendor_mgmt:'厂商管理',add_vendor:'添加厂商',add_btn:'添加',select_btn:'选择',
            no_vendors_selected:'未选择厂商',cannot_delete:'无法删除',models_in_use:'以下型号正被设备使用',
            change_or_delete_first:'请先修改设备型号或删除这些设备',ok:'确定',
            delete_blocked:'无法删除 — 有设备或类型正在使用',
            delete_type_hint:'以下设备正在使用该类型：',
            delete_cat_hint:'以下设备引用该类别下的类型：',
            cat_has_types:'该类别下有 {count} 种类型正在使用：{types}',
            delete_type_hint2:'请先在设备管理页面修改设备类型，或先删除所有使用该类型的设备，然后再删除此类别。',
            network_label:'网络设备',server_label:'服务器',custom_label:'自定义',
            router:'路由器',switch:'交换机',firewall:'防火墙',load_balancer:'负载均衡',
            server_linux:'Linux服务器',server_windows:'Windows服务器',
            wireless_ap:'无线AP',wireless_controller:'无线控制器',
            printer:'打印机',ups:'UPS电源',storage:'存储设备',ip_phone:'IP电话',camera:'摄像头',
            protocol:'管理协议',device_model:'设备型号',agent_port:'Agent端口',
            web_port:'Web端口',monitoring_interval:'采集间隔(秒)',
            monitoring_template:'监控模板',select_model_first:'请先选择型号',
            device_added_success:'设备添加成功',device_add_failed:'添加失败',
            snmp_settings:'SNMP设置',agent_settings:'Agent设置',
            web_settings:'Web设置',icmp_settings:'ICMP设置',
            ssh_port:'SSH端口',select_model:'选择设备型号',model_name:'型号名称',interfaces:'接口',
            icmp_no_extra:'ICMP模式无需额外配置',additional_settings:'其他设置',
            monitoring_interval_hint:'秒，建议30-300',
            no_template:'不使用模板',add_device_save:'添加设备',
            no_device_models:'暂无预设设备型号，',
            seed_models:'立即导入',ip_required:'IP地址不能为空',
            ip_invalid:'IP地址格式无效',
            add_device_failed:'添加失败',saving:'保存中...',
            // Discovery page
            device_discovery:'设备发现',scan_desc:'扫描网段以发现ICMP和SNMP设备',
            network_scan:'网络扫描',network_ranges:'网段范围',
            ranges_placeholder:'例: 192.168.1.0/24, 10.0.0.0-200, 172.16.0.1-172.16.0.50',
            ranges_hint:'支持CIDR、IP范围和逗号分隔的多个网段',
            snmp_community:'SNMP 团队名',communities_hint:'逗号分隔多个',
            start_scan:'开始扫描',scanning:'扫描中...',initializing:'初始化扫描...',
            scan_complete:'扫描完成',devices_found:'发现设备',
            discovered_devices:'已发现设备',no_devices:'暂无已发现的设备',no_devices_hint:'在上方输入网段后点击扫描',
            refresh:'刷新',ip_address:'IP地址',hostname:'主机名',
            type:'类型',vendor:'厂商',icmp:'ICMP',snmp:'SNMP',
            discovered:'发现时间',actions:'操作',approve:'批准',
            // Devices page
            managed_devices:'已管理设备',search_devices:'搜索设备...',
            all_types:'所有类型',all_status:'所有状态',
            status:'状态',name:'名称',model:'型号',last_seen:'最后在线',
            no_managed:'暂无已管理设备',go_discovery:'前往设备发现添加设备',
            enabled:'已启用',disabled:'已禁用',
            view_details:'详情',edit:'编辑',delete:'删除',
            edit_device:'编辑设备',save_changes:'保存修改',
            device_name_required:'设备名不能为空',
            updated_success:'更新成功',update_failed:'更新失败',
            approved_success:'批准成功，已添加到管理列表',managed:'已管理',
            approve_failed:'批准失败',load_failed:'加载失败',
            // Topology page
            device_library:'设备库',click_add:'点击添加设备到画布',
            export_topo:'导出',import_topo:'导入',
            add_note:'添加备注',auto_discover:'自动发现',
            online:'在线',offline:'离线',warning:'告警',
            no_topo:'暂无拓扑数据',no_topo_hint1:'在左侧设备库中点击 + 添加设备',
            no_topo_hint2:'或使用 自动发现 扫描网络拓扑',
            loading:'加载中...',
            // Dashboard
            total_devices:'设备总数',online_count:'在线',warning_count:'告警',offline_count:'离线',
            no_active_devices:'暂无活跃设备',
            last_updated:'最后更新',no_data:'暂无数据',
            // Alerts
            alert_history:'告警历史',alert_rules:'告警规则',
            add_rule:'添加规则',severity:'严重级别',triggered:'触发时间',
            resolved:'解决时间',acknowledge:'确认',
            active:'活跃',acknowledged:'已确认',
            no_alerts:'暂无告警',no_rules:'暂无告警规则',
            // Common
            cancel:'取消',confirm:'确认',
            rename:'重命名',change_icon:'更换图标和颜色',
            edit_details:'编辑详情',remove_from_map:'从图中移除',
            ssh_connect:'SSH连接',rdp_connect:'RDP连接',
            web_interface:'Web界面',view_dashboard:'查看仪表盘',
            edit_label:'编辑标签',line_style:'线型',port_names:'端口名称',
            solid:'实线',dashed:'虚线',dotted:'点线',
            arrow:'箭头',show_arrow:'显示目标端箭头',
            copy:'复制',edit_note:'编辑文本',delete_note_confirm:'确认删除此备注？',
            // Actions
            scanned:'已扫描',found:'已发现',
            scan_started:'扫描已启动',scan_failed:'扫描启动失败',stop:'停止',clear:'清空',deploy_complete:'部署完成',
            scan_status:'扫描状态',scan_progress:'扫描进度',
            device_name:'设备名称',device_type:'设备类型',device_name_label:'设备名称 *',
            snmp_community_label:'SNMP 团队名',snmp_version:'SNMP版本',snmp_port:'SNMP端口',
            snmp_enabled:'启用SNMP',custom_type:'自定义类型',
            approve_device:'批准设备',approve_add:'批准并添加设备',
            discovered_info:'已发现信息',not_detected:'未检测到',
            name_updated:'名称已更新',node_deleted:'节点已删除',
            edge_deleted:'连线已删除',icon_updated:'图标已更新',
            copied:'已复制到剪贴板',copy_failed:'复制失败',
            device_approved:'设备已批准',topo_saved:'拓扑已保存',
            delete_confirm:'确认删除？',delete_node_confirm:'确认删除此节点及所有连线？',
            delete_edge_confirm:'确认删除此连线？',
            edit_node_label:'编辑节点名称',new_name:'新名称',
            // Widget & Dashboard
            widget_title:'挂件',add_widget:'添加挂件',select_device:'选择设备',
            select_metric:'选择指标',chart_type:'图表类型',widget_size:'挂件尺寸',
            line_chart:'折线图',gauge_chart:'仪表盘',big_number:'大数字',
            small:'小',medium:'中',large:'大',
            no_widgets:'暂无挂件，点击上方按钮添加',remove_widget:'移除挂件',
            memory:'内存',metric_name:'指标名称',
            monitoring_mgmt:'监控管理',snmp_templates:'SNMP模板',
            add_template:'新建模板',import_mib:'导入MIB',add_item:'添加监控项',
            no_templates:'暂无模板',no_items:'暂无监控项',unit:'单位',display:'显示方式',interval:'间隔',description:'描述',
            mib_found:'解析到',mib_select_hint:'勾选需要添加的OID，可修改自定义名称',add_selected:'添加选中项',import_cisco_list:'导入Cisco支持列表',parsing_file:'正在解析文件...',uploading_file:'上传文件',file_size:'文件大小',search_oid:'搜索 OID',
            // MIB Management
            mib_mgmt:'MIB管理',mib_files:'MIB文件',cisco_list:'Cisco支持列表',
            upload_mib:'上传MIB',upload_cisco_list:'上传Cisco支持列表',
            no_mib_files:'暂无上传的MIB文件',mib_upload_hint:'上传 .mib 或 .my 文件以解析 OID',
            no_cisco_lists:'暂无上传的Cisco支持列表',cisco_upload_hint:'上传 Cisco MIB 支持列表 HTML 文件',
            ai_analyze:'AI分析',ai_analyze_desc:'AI将分析该MIB文件中每条OID的作用，生成中英文描述、建议单位、展示类型和重要程度。',
            ai_analyze_note:'根据OID数量，可能需要30-120秒',ai_analyzing:'AI正在分析MIB OID...',
            ai_analyze_done:'分析完成',ai_analyzed_count:'分析',ai_updated_count:'更新',ai_records:'条记录',
            importance:'重要程度',ai_config_hint:'请先在 设置 → AI设置 中配置AI参数',
            upload_failed:'上传失败',ok:'确定',none:'无',
            // AI Settings
            ai_settings:'AI设置',ai_settings_desc:'配置AI API用于MIB分析。支持OpenAI兼容API。',
            ai_provider:'服务商',ai_key_hint:'API密钥，加密保存在服务器端',
            ai_base_hint:'API端点的基础URL',ai_model:'模型名称',
            ai_model_hint:'例如 gpt-4o-mini, gpt-4o, deepseek-chat, qwen2.5',
            ai_key_required:'请输入API Key',test_connection:'测试连接',
            ai_batch_size:'每轮分析数量',ai_batch_hint:'每轮AI调用最大OID数，超量自动分批',
            ai_concurrency:'并发数',ai_concurrency_hint:'每组并行AI调用数',
            ai_req_timeout:'请求超时(秒)',ai_grp_timeout:'组超时(秒)',
            // Template MIB association
            associate_mib:'关联MIB',associate_mib_desc:'选择要关联到此模板的MIB文件。关联后可在添加监控项时看到OID的详细描述。',
            linked_mibs:'关联的MIB',linked_cisco_list:'关联的Cisco支持列表',
            no_linked_mibs_hint:'提示：关联MIB文件后可查看OID描述',add_from_mib:'从关联的MIB中添加',
            // Monitoring settings
            monitoring_settings:'监控设置',
            close:'关闭',view_details:'查看详情',no_description:'暂无描述',
            re_analyze:'重新分析',reparse_cisco:'重新下载解析MIB',
            all_sources:'全部MIB',export:'导出',
            oid_name:'OID名称',mib_source:'所属MIB',oid_number:'OID编号',
            config_test:'配置测试',test:'测试',testing:'测试中...',
            config_test_first:'请先配置SNMP测试参数',test_result:'测试结果',result:'结果',
            snmp_test_console:'SNMP测试控制台',test_all:'一键测试',stop_test:'停止测试',
            all_results:'全部结果',errors_only:'仅错误',success_only:'仅成功',
            test_concurrency:'测试并发数',test_retries:'测试重试次数',
            prev_result:'上次结果',curr_result:'本次结果',compare_results:'对比结果',
            // Zabbix Templates
            zabbix_templates:'Zabbix模板',zabbix_repo:'Zabbix模板仓库',refresh_repo:'刷新仓库',
            import_from_zabbix:'从Zabbix导入',preview_template:'预览模板',import_template:'导入模板',
            import_selected:'导入选中项',import_all:'导入全部',zabbix_source:'来源:Zabbix',
            template_preview:'模板预览',items_to_import:'待导入监控项',discovery_rules:'发现规则',
            macros:'宏变量',triggers:'触发器',no_zabbix_files:'暂无文件，请刷新仓库',
            repo_refreshed:'仓库已刷新',import_success:'导入成功',import_failed:'导入失败',
            already_imported:'已导入模板',no_imported_zabbix:'暂无已导入的Zabbix模板',
            browse_zabbix_repo:'浏览Zabbix仓库',imported_templates:'个已导入模板',
            cached:'缓存',templates:'模板',in:'在',folders:'个目录',showing:'显示',
            items:'项',group:'分组',select_items_first:'请先选择要导入的监控项',
        },
        en: {
            dashboard:'Dashboard',discovery:'Discovery',devices:'Devices',
            topology:'Topology',racks:'Rack View',alerts:'Alerts',
            'add-device':'Add Device',add_device:'Add Device',add_device_desc:'Manually add network device or host',
            'device-models':'Device Models',device_models_title:'Device Models',add_model:'Add Model',
            device_list:'Device List',device_mgmt:'Device Mgmt',category:'Category',settings:'Settings',save:'Save',failed:'Failed',settings_saved:'Settings saved',icmp_interval_label:'ICMP Check Interval (s)',icmp_interval_hint:'How often to ping devices',snmp_interval_label:'SNMP Collection Interval (s)',snmp_interval_hint:'How often to poll SNMP metrics',alert_interval_label:'Alert Check Interval (s)',alert_interval_hint:'How often to evaluate alert rules',scan_concurrency_label:'Scan Concurrency',scan_concurrency_hint:'How many IPs to scan simultaneously',
            device_types_custom:'Device Type Mgmt',add_type:'Add Type',no_custom_types:'No custom types',
            category_mgmt:'Category Mgmt',add_category:'Add Category',
            import_csv:'Import CSV',export_csv:'Export CSV',
            import_btn:'Import',import_hint:'Supports CSV and TXT format',
            export_btn:'Export',export_hint:'Export as CSV or TXT',
            vendor_mgmt:'Vendor Mgmt',add_vendor:'Add Vendor',add_btn:'Add',select_btn:'Select',
            no_vendors_selected:'No vendors selected',cannot_delete:'Cannot Delete',models_in_use:'Models in use',
            change_or_delete_first:'Change device models or delete devices first',ok:'OK',
            delete_blocked:'Cannot Delete — In Use',
            delete_type_hint:'The following devices use this type:',
            delete_cat_hint:'The following devices use types in this category:',
            cat_has_types:'This category has {count} type(s) in use: {types}',
            delete_type_hint2:'Please change device types or delete devices before deleting this category.',
            network_label:'Network',server_label:'Server',custom_label:'Custom',
            router:'Router',switch:'Switch',firewall:'Firewall',load_balancer:'Load Balancer',
            server_linux:'Linux Server',server_windows:'Windows Server',
            wireless_ap:'Wireless AP',wireless_controller:'Wireless Controller',
            printer:'Printer',ups:'UPS',storage:'Storage',ip_phone:'IP Phone',camera:'Camera',
            protocol:'Protocol',device_model:'Device Model',agent_port:'Agent Port',
            web_port:'Web Port',monitoring_interval:'Collection Interval (s)',
            monitoring_template:'Monitoring Template',select_model_first:'Select model first',
            device_added_success:'Device added successfully',device_add_failed:'Add failed',
            snmp_settings:'SNMP Settings',agent_settings:'Agent Settings',
            web_settings:'Web Settings',icmp_settings:'ICMP Settings',
            ssh_port:'SSH Port',select_model:'Select device model',model_name:'Model Name',interfaces:'Interfaces',
            icmp_no_extra:'No extra configuration needed for ICMP',additional_settings:'Additional Settings',
            monitoring_interval_hint:'seconds, recommended 30-300',
            no_template:'No template',add_device_save:'Add Device',
            no_device_models:'No device models available. ',
            seed_models:'Seed models now',ip_required:'IP address is required',
            ip_invalid:'Invalid IP address format',
            add_device_failed:'Add device failed',saving:'Saving...',
            device_discovery:'Device Discovery',scan_desc:'Scan networks to discover ICMP and SNMP devices',
            network_scan:'Network Scan',network_ranges:'Network Ranges',
            ranges_placeholder:'e.g. 192.168.1.0/24, 10.0.0.0-200',
            ranges_hint:'Supports CIDR, IP ranges, comma-separated',
            snmp_community:'SNMP Community',communities_hint:'Comma-separated for multiple',
            start_scan:'Start Scan',scanning:'Scanning...',initializing:'Initializing...',
            scan_complete:'Scan complete',devices_found:'devices found',
            discovered_devices:'Discovered Devices',no_devices:'No devices discovered',no_devices_hint:'Enter a network range above and click Start Scan',
            refresh:'Refresh',ip_address:'IP Address',hostname:'Hostname',
            type:'Type',vendor:'Vendor',icmp:'ICMP',snmp:'SNMP',
            discovered:'Discovered',actions:'Actions',approve:'Approve',
            managed_devices:'Managed Devices',search_devices:'Search...',
            all_types:'All Types',all_status:'All Status',
            status:'Status',name:'Name',model:'Model',last_seen:'Last Seen',
            no_managed:'No managed devices',go_discovery:'Go to Discovery to add devices',
            enabled:'Enabled',disabled:'Disabled',
            view_details:'Details',edit:'Edit',delete:'Delete',
            edit_device:'Edit Device',save_changes:'Save Changes',
            device_name_required:'Device name is required',
            updated_success:'Updated successfully',update_failed:'Update failed',
            approved_success:'Device approved and added',managed:'Managed',
            approve_failed:'Approve failed',load_failed:'Failed to load',
            device_library:'Device Library',click_add:'Click to add device to canvas',
            export_topo:'Export',import_topo:'Import',
            add_note:'Add Note',auto_discover:'Auto-Discover',
            online:'Online',offline:'Offline',warning:'Warning',
            no_topo:'No topology data',no_topo_hint1:'Click + on a device to add it',
            no_topo_hint2:'or use Auto-Discover to map your network',
            loading:'Loading...',
            total_devices:'Total Devices',online_count:'Online',warning_count:'Warning',offline_count:'Offline',
            no_active_devices:'No active devices',
            last_updated:'Last updated',no_data:'No data yet',
            alert_history:'Alert History',alert_rules:'Alert Rules',
            add_rule:'Add Rule',severity:'Severity',triggered:'Triggered',
            resolved:'Resolved',acknowledge:'Acknowledge',
            active:'Active',acknowledged:'Acknowledged',
            no_alerts:'No alerts',no_rules:'No alert rules',
            cancel:'Cancel',confirm:'Confirm',
            rename:'Rename',change_icon:'Change Shape & Color',
            edit_details:'Edit Details',remove_from_map:'Remove from Map',
            ssh_connect:'SSH Connect',rdp_connect:'RDP Connect',
            web_interface:'Web Interface',view_dashboard:'View Dashboard',
            edit_label:'Edit Label',line_style:'Line Style',port_names:'Port Names',
            solid:'Solid',dashed:'Dashed',dotted:'Dotted',
            arrow:'Arrow',show_arrow:'Show arrow at target',
            copy:'Copy',edit_note:'Edit Text',delete_note_confirm:'Delete this note?',
            scanned:'Scanned',found:'Found',
            scan_started:'Scan started',scan_failed:'Failed to start scan',stop:'Stop',clear:'Clear',deploy_complete:'Deploy complete',
            scan_status:'Scan Status',scan_progress:'Scan Progress',
            device_name:'Device Name',device_type:'Device Type',device_name_label:'Device Name *',
            snmp_community_label:'SNMP Community',snmp_version:'SNMP Version',snmp_port:'SNMP Port',
            snmp_enabled:'Enable SNMP',custom_type:'Custom type',
            approve_device:'Approve Device',approve_add:'Approve & Add Device',
            discovered_info:'Discovered Info',not_detected:'Not detected',
            name_updated:'Name updated',node_deleted:'Node deleted',
            edge_deleted:'Edge deleted',icon_updated:'Icon updated',
            copied:'Copied to clipboard',copy_failed:'Copy failed',
            device_approved:'Device approved',topo_saved:'Topology saved',
            delete_confirm:'Confirm delete?',delete_node_confirm:'Delete this node and all connections?',
            delete_edge_confirm:'Delete this connection?',
            edit_node_label:'Edit Node Name',new_name:'New name',
            // Widget & Dashboard
            widget_title:'Widget',add_widget:'Add Widget',select_device:'Select Device',
            select_metric:'Select Metric',chart_type:'Chart Type',widget_size:'Widget Size',
            line_chart:'Line Chart',gauge_chart:'Gauge',big_number:'Big Number',
            small:'Small',medium:'Medium',large:'Large',
            no_widgets:'No widgets. Click the button above to add one.',remove_widget:'Remove Widget',
            memory:'Memory',metric_name:'Metric Name',
            monitoring_mgmt:'Monitoring',snmp_templates:'SNMP Templates',
            add_template:'New Template',import_mib:'Import MIB',add_item:'Add Item',
            no_templates:'No templates',no_items:'No items',unit:'Unit',display:'Display',interval:'Interval',description:'Description',
            mib_found:'Found',mib_select_hint:'Check OIDs to add. You can rename them.',add_selected:'Add Selected',import_cisco_list:'Import Cisco List',parsing_file:'Parsing file...',uploading_file:'Uploading file',file_size:'File size',search_oid:'Search OID',
            // MIB Management
            mib_mgmt:'MIB Management',mib_files:'MIB Files',cisco_list:'Cisco Support Lists',
            upload_mib:'Upload MIB',upload_cisco_list:'Upload Cisco List',
            no_mib_files:'No MIB files uploaded',mib_upload_hint:'Upload .mib or .my files to parse OIDs',
            no_cisco_lists:'No Cisco support lists uploaded',cisco_upload_hint:'Upload Cisco MIB support list HTML files',
            ai_analyze:'AI Analyze',ai_analyze_desc:'AI will analyze each OID in this MIB file and generate Chinese/English descriptions, suggested units, display types, and importance levels.',
            ai_analyze_note:'This may take 30-120 seconds depending on the number of OIDs.',ai_analyzing:'AI is analyzing MIB OIDs...',
            ai_analyze_done:'Analysis Complete',ai_analyzed_count:'Analyzed',ai_updated_count:'Updated',ai_records:'records',
            importance:'Importance',ai_config_hint:'Please configure AI settings first in Settings → AI Settings',
            upload_failed:'Upload failed',ok:'OK',none:'None',
            // AI Settings
            ai_settings:'AI Settings',ai_settings_desc:'Configure AI API for MIB analysis. Supports OpenAI-compatible APIs.',
            ai_provider:'Provider',ai_key_hint:'Your API key. Stored encrypted on the server.',
            ai_base_hint:'The base URL of the API endpoint',ai_model:'Model Name',
            ai_model_hint:'e.g. gpt-4o-mini, gpt-4o, deepseek-chat, qwen2.5',
            ai_key_required:'API Key is required',test_connection:'Test Connection',
            ai_batch_size:'Batch Size',ai_batch_hint:'Max OIDs per AI call. Excess is auto-split into rounds.',
            ai_concurrency:'Concurrency',ai_concurrency_hint:'Parallel AI calls per group',
            ai_req_timeout:'Request Timeout(s)',ai_grp_timeout:'Group Timeout(s)',
            // Template MIB association
            associate_mib:'Link MIB',associate_mib_desc:'Select MIB files to link to this template. Linked OIDs will be available with descriptions when adding monitoring items.',
            linked_mibs:'Linked MIBs',linked_cisco_list:'Linked Cisco List',
            no_linked_mibs_hint:'Tip: Link MIB files to see OID descriptions',add_from_mib:'Add from linked MIBs',
            // Monitoring settings
            monitoring_settings:'Monitoring Settings',
            close:'Close',view_details:'View Details',no_description:'No description',
            re_analyze:'Re-analyze',reparse_cisco:'Re-download MIBs',
            all_sources:'All MIBs',export:'Export',
            oid_name:'OID Name',mib_source:'MIB Source',oid_number:'OID',
            config_test:'Config Test',test:'Test',testing:'Testing...',
            config_test_first:'Configure SNMP test settings first',test_result:'Test Result',result:'Result',
            snmp_test_console:'SNMP Test Console',test_all:'Test All',stop_test:'Stop',
            all_results:'All Results',errors_only:'Errors Only',success_only:'Success Only',
            test_concurrency:'Test Concurrency',test_retries:'Test Retries',
            prev_result:'Prev Result',curr_result:'Current Result',compare_results:'Compare',
            // Zabbix Templates
            zabbix_templates:'Zabbix Templates',zabbix_repo:'Zabbix Repo',refresh_repo:'Refresh Repo',
            import_from_zabbix:'Import from Zabbix',preview_template:'Preview',import_template:'Import',
            import_selected:'Import Selected',import_all:'Import All',zabbix_source:'Source: Zabbix',
            template_preview:'Template Preview',items_to_import:'Items to Import',discovery_rules:'Discovery Rules',
            macros:'Macros',triggers:'Triggers',no_zabbix_files:'No files. Refresh repo.',
            repo_refreshed:'Repo refreshed',import_success:'Import success',import_failed:'Import failed',
            already_imported:'Imported Templates',no_imported_zabbix:'No imported Zabbix templates yet.',
            browse_zabbix_repo:'Browse Zabbix Repo',imported_templates:'imported templates',
            cached:'Cached',templates:'templates',in:'in',folders:'folders',showing:'Showing',
            items:'items',group:'Group',select_items_first:'Select items to import first',
        }
    },

    t(key) {
        return (this.DICT[this._lang] && this.DICT[this._lang][key]) || key;
    },

    get lang() { return this._lang; },

    toggle() {
        this._lang = this._lang === 'zh' ? 'en' : 'zh';
        localStorage.setItem('nms_lang', this._lang);
        return this._lang;
    },

    apply() {
        var lang = this._lang;
        var dict = this.DICT[lang] || {};

        // Sidebar nav spans
        // Translate all sidebar nav items dynamically
        var navItems = document.querySelectorAll('[data-page] span');
        for (var ni = 0; ni < navItems.length; ni++) {
            var pageSpan = navItems[ni];
            var pageKey = pageSpan.parentElement.getAttribute('data-page');
            if (pageKey && dict[pageKey]) pageSpan.textContent = dict[pageKey];
        }

        // Lang switch highlight
        var zhEl = document.getElementById('langZh');
        var enEl = document.getElementById('langEn');
        if (zhEl && enEl) {
            zhEl.className = 'lang-option' + (lang === 'zh' ? ' active' : '');
            enEl.className = 'lang-option' + (lang === 'en' ? ' active' : '');
        }

        // All [data-i18n] elements
        var els = document.querySelectorAll('[data-i18n]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var key = el.getAttribute('data-i18n');
            if (!key || !dict[key]) continue;
            if (el.children.length === 0) {
                el.textContent = dict[key];
            } else {
                for (var j = 0; j < el.childNodes.length; j++) {
                    var node = el.childNodes[j];
                    if (node.nodeType === 3 && node.textContent.trim()) {
                        node.textContent = ' ' + dict[key];
                        break;
                    }
                }
            }
        }

        // [data-i18n-placeholder]
        var inputs = document.querySelectorAll('[data-i18n-placeholder]');
        for (var m = 0; m < inputs.length; m++) {
            var inp = inputs[m];
            var k = inp.getAttribute('data-i18n-placeholder');
            if (k && dict[k]) inp.placeholder = dict[k];
        }
    }
};

window.T = function(k) {
    // Check custom types first (from localStorage)
    try {
        var customTypes = JSON.parse(localStorage.getItem('nms_device_types') || '[]');
        for (var i = 0; i < customTypes.length; i++) {
            if (customTypes[i].key === k) {
                return (window.I18N.lang === 'zh') ? customTypes[i].zh : customTypes[i].en;
            }
        }
    } catch(e) {}
    return window.I18N.t(k);
};

document.addEventListener('DOMContentLoaded', function() {
    window.I18N.apply();
});
