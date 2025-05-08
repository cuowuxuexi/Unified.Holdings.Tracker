import React, { useEffect, useState } from 'react';
import { Select, Spin, Button, Typography, Tooltip, Modal, Input } from 'antd';
import useAppStore from '../store';
import { ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import CreatePortfolioForm from './CreatePortfolioForm';
import { Rnd } from 'react-rnd';
import type { DraggableData, Position, ResizableDelta } from 'react-rnd';

interface RndState {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

// 使用更精确的类型断言
const RndComponent = Rnd as unknown as React.ComponentClass<any>;

const { Option } = Select;
const { Title, Text } = Typography;

// 预设语录列表
const PRESET_QUOTES = [
  "赢不了巴菲特，就别投资了",
  "投资需谨慎，风险需明确",
  "复利是世界第八大奇迹",
  "投资只需做两件事：等待和等待",
  "在别人恐惧时贪婪，在别人贪婪时恐惧"
];

interface QuoteItem {
  id: string;
  content: string;
  isMain?: boolean;
}

interface PortfolioListProps {
  collapsed?: boolean;
  setCollapsed?: (collapsed: boolean) => void;
}

const PortfolioList: React.FC<PortfolioListProps> = ({ collapsed = false, setCollapsed }): React.ReactElement => {
  // 拖拽/缩放主语录
  const defaultRnd: RndState = {
    x: 0,
    y: 0,
    width: 120,
    height: 220,
    fontSize: 28
  };

  // 副语录的拖拽/缩放配置
  const defaultOtherQuotesRnd: RndState = {
    x: 0,
    y: 120,
    width: 180,
    height: 100,
    fontSize: 14
  };

  // 状态管理
  // Use individual selectors for better performance and to avoid unnecessary re-renders
  const portfolios = useAppStore((state) => state.portfolios);
  const selectedPortfolioId = useAppStore((state) => state.selectedPortfolioId);
  const isLoadingPortfolios = useAppStore((state) => state.isLoadingPortfolios);
  const fetchPortfolios = useAppStore((state) => state.fetchPortfolios);
  const selectPortfolio = useAppStore((state) => state.selectPortfolio);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isQuoteModalVisible, setIsQuoteModalVisible] = useState(false);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [mainQuoteId, setMainQuoteId] = useState<string | null>(null);
  const [newQuote, setNewQuote] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  // 添加新的状态变量控制语录调整按钮的显示
  const [isMainQuoteActive, setIsMainQuoteActive] = useState(false);
  const [isOtherQuotesActive, setIsOtherQuotesActive] = useState(false);
  // 添加副语录字体大小状态

  const [rndState, setRndState] = useState<RndState>(() => {
    const saved = localStorage.getItem('mainQuoteRnd');
    return saved ? JSON.parse(saved) : defaultRnd;
  });
  
  const [otherQuotesRndState, setOtherQuotesRndState] = useState<RndState>(() => {
    const saved = localStorage.getItem('otherQuotesRnd');
    return saved ? JSON.parse(saved) : defaultOtherQuotesRnd;
  });

  useEffect(() => {
    // 初始加载投资组合列表
    handleRefresh();

    // 初始化从localStorage加载语录
    const saved = localStorage.getItem('portfolioQuotes');
    if (saved) {
      const arr: QuoteItem[] = JSON.parse(saved);
      setQuotes(arr);
      const main = arr.find(q => q.isMain);
      setMainQuoteId(main ? main.id : (arr[0]?.id || null));
    } else {
      // 首次加载用预设
      const arr = PRESET_QUOTES.map((q, i) => ({ id: String(i+1), content: q, isMain: i === 0 }));
      setQuotes(arr);
      setMainQuoteId(arr[0].id);
      localStorage.setItem('portfolioQuotes', JSON.stringify(arr));
    }
  }, []); // 只在组件挂载时执行

  const handleSelectChange = (value: string | null) => {
    selectPortfolio(value);
  };

  const showCreateModal = () => {
    setIsCreateModalVisible(true);
  };

  const handleCreateSuccess = () => {
    setIsCreateModalVisible(false);
    // 创建成功后刷新列表
    handleRefresh();
  };
  
  // 刷新投资组合列表
  const handleRefresh = () => {
    // 这里实现真正的刷新逻辑
    fetchPortfolios();
  };
  
  // 保存到localStorage
  const saveQuotes = (arr: QuoteItem[]) => {
    setQuotes(arr);
    localStorage.setItem('portfolioQuotes', JSON.stringify(arr));
    const main = arr.find(q => q.isMain);
    setMainQuoteId(main ? main.id : (arr[0]?.id || null));
  };

  // 添加/编辑语录
  const handleSaveQuote = () => {
    if (!newQuote.trim()) return;
    if (editId) {
      const arr = quotes.map(q => q.id === editId ? { ...q, content: newQuote } : q);
      saveQuotes(arr);
      setEditId(null);
    } else {
      const id = Date.now().toString();
      const arr = [...quotes, { id, content: newQuote }];
      saveQuotes(arr);
    }
    setNewQuote('');
  };

  // 删除语录
  const handleDeleteQuote = (id: string) => {
    let arr = quotes.filter(q => q.id !== id);
    // 如果删除的是主语录，自动设下一个为主
    if (mainQuoteId === id) {
      if (arr.length > 0) arr[0].isMain = true;
      setMainQuoteId(arr[0]?.id || null);
    }
    arr = arr.map((q, i) => ({ ...q, isMain: i === 0 }));
    saveQuotes(arr);
  };

  // 设为主语录
  const handleSetMain = (id: string) => {
    const arr = quotes.map(q => ({ ...q, isMain: q.id === id }));
    saveQuotes(arr);
    setMainQuoteId(id);
  };

  // 编辑语录
  const handleEditQuote = (id: string) => {
    const q = quotes.find(q => q.id === id);
    if (q) {
      setNewQuote(q.content);
      setEditId(id);
    }
  };

  // 语录管理弹窗
  const renderQuoteModal = () => (
    <Modal
      title="管理语录"
      open={isQuoteModalVisible}
      onCancel={() => { setIsQuoteModalVisible(false); setNewQuote(''); setEditId(null); }}
      onOk={() => { setIsQuoteModalVisible(false); setNewQuote(''); setEditId(null); }}
      footer={null}
      destroyOnClose
    >
      <div style={{ marginBottom: 16 }}>
        <Input.TextArea
          rows={2}
          value={newQuote}
          onChange={e => setNewQuote(e.target.value)}
          placeholder="输入新语录"
          maxLength={50}
          showCount
        />
        <Button
          type="primary"
          style={{ marginTop: 8, width: '100%' }}
          onClick={handleSaveQuote}
        >{editId ? '保存修改' : '添加语录'}</Button>
      </div>
      <div>
        {quotes.map(q => (
          <div key={q.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 8, background: q.isMain ? '#fffbe6' : undefined, borderRadius: 6, padding: 6 }}>
            <span style={{ flex: 1, color: q.isMain ? '#faad14' : '#222', fontWeight: q.isMain ? 700 : 400 }}>{q.content}</span>
            <Button size="small" icon={<EditOutlined />} style={{ marginLeft: 4 }} onClick={() => handleEditQuote(q.id)} />
            <Button size="small" icon={<DeleteOutlined />} style={{ marginLeft: 4 }} danger onClick={() => handleDeleteQuote(q.id)} />
            {!q.isMain && <Button size="small" style={{ marginLeft: 4 }} onClick={() => handleSetMain(q.id)}>设为主语录</Button>}
            {q.isMain && <span style={{ color: '#faad14', marginLeft: 4, fontSize: 12 }}>主语录</span>}
          </div>
        ))}
      </div>
    </Modal>
  );

  // 主语录内容
  const mainQuote = quotes.find(q => q.isMain) || quotes[0];
  const otherQuotes = quotes.filter(q => !q.isMain);

  // 主语录分两列竖排
  let mainCol1 = '', mainCol2 = '';
  if (mainQuote && mainQuote.content) {
    const chars = mainQuote.content.split('');
    const mid = Math.ceil(chars.length / 2);
    mainCol1 = chars.slice(0, mid).join('');
    mainCol2 = chars.slice(mid).join('');
  }

  // 更新主语录位置和大小
  const handleRndChange = (
    position: Position | Pick<DraggableData, 'x' | 'y'>,
    size?: { width: number; height: number }
  ) => {
    const newState: RndState = {
      ...rndState,
      x: position.x,
      y: position.y,
      width: size ? size.width : rndState.width,
      height: size ? size.height : rndState.height,
      fontSize: rndState.fontSize
    };
    setRndState(newState);
    localStorage.setItem('mainQuoteRnd', JSON.stringify(newState));
  };
   
  // 更新副语录位置和大小
  const handleOtherQuotesRndChange = (
    position: Position | Pick<DraggableData, 'x' | 'y'>,
    size?: { width: number; height: number }
  ) => {
    const newState: RndState = {
      ...otherQuotesRndState,
      x: position.x,
      y: position.y,
      width: size ? size.width : otherQuotesRndState.width,
      height: size ? size.height : otherQuotesRndState.height,
      fontSize: otherQuotesRndState.fontSize
    };
    setOtherQuotesRndState(newState);
    localStorage.setItem('otherQuotesRnd', JSON.stringify(newState));
  };

  const handleFontSizeChange = (delta: number) => {
    const newState = { ...rndState, fontSize: Math.max(16, rndState.fontSize + delta) };
    setRndState(newState);
    localStorage.setItem('mainQuoteRnd', JSON.stringify(newState));
  };
  
  const handleResetRnd = () => {
    setRndState(defaultRnd);
    localStorage.setItem('mainQuoteRnd', JSON.stringify(defaultRnd));
  };

  // 处理主语录点击事件
  const handleMainQuoteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMainQuoteActive(true);
    setIsOtherQuotesActive(false);
  };

  // 处理副语录点击事件
  const handleOtherQuotesClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOtherQuotesActive(true);
    setIsMainQuoteActive(false);
  };

  // 处理副语录字体大小调整
  const handleOtherQuotesFontSizeChange = (delta: number) => {
    const newSize = Math.max(12, otherQuotesRndState.fontSize + delta);
    const newState = { ...otherQuotesRndState, fontSize: newSize };
    setOtherQuotesRndState(newState);
    localStorage.setItem('otherQuotesRnd', JSON.stringify(newState));
  };

  // 重置副语录字体大小和位置
  const handleResetOtherQuotes = () => {
    setOtherQuotesRndState(defaultOtherQuotesRnd);
    localStorage.setItem('otherQuotesRnd', JSON.stringify(defaultOtherQuotesRnd));
  };

  // 处理全局点击事件，用于隐藏所有调整按钮
  const handleGlobalClick = () => {
    setIsMainQuoteActive(false);
    setIsOtherQuotesActive(false);
  };

  // 折叠状态下的渲染
  if (collapsed) {
    // 使用上面已经计算好的 mainCol1 和 mainCol2
    if (mainQuote && mainQuote.content) {
      const chars = mainQuote.content.split('');
      const mid = Math.ceil(chars.length / 2);
      mainCol1 = chars.slice(0, mid).join('');
      mainCol2 = chars.slice(mid).join('');
    }
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#fafbfc',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        padding: '20px 0',
        minWidth: 0
      }}>
        {/* 顶部操作按钮 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center' }}>
          <Tooltip title="刷新投资组合列表" placement="right">
            <Button
              type="text"
              icon={<ReloadOutlined spin={isLoadingPortfolios} style={{ fontSize: 20 }} />}
              onClick={handleRefresh}
              loading={isLoadingPortfolios}
              style={{ border: 'none', boxShadow: 'none', marginBottom: 8 }}
            />
          </Tooltip>
          <Tooltip title="新建投资组合" placement="right">
            <Button
              type="text"
              icon={<PlusOutlined style={{ fontSize: 20 }} />}
              style={{ border: 'none', boxShadow: 'none' }}
              onClick={showCreateModal}
            />
          </Tooltip>
        </div>
        {/* 主语录内容竖排居中显示 */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: 0,
        }}>
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            gap: 4
          }}>
            <div style={{
              writingMode: 'vertical-rl',
              fontSize: 20,
              fontWeight: 700,
              color: '#223',
              letterSpacing: 2,
              lineHeight: 1.2,
              textAlign: 'center',
              whiteSpace: 'pre-line',
              padding: '0 2px',
              userSelect: 'none',
              maxHeight: '220px',
              overflow: 'hidden',
            }}>{mainCol1}</div>
            <div style={{
              writingMode: 'vertical-rl',
              fontSize: 20,
              fontWeight: 700,
              color: '#223',
              letterSpacing: 2,
              lineHeight: 1.2,
              textAlign: 'center',
              whiteSpace: 'pre-line',
              padding: '0 2px',
              userSelect: 'none',
              maxHeight: '220px',
              overflow: 'hidden',
            }}>{mainCol2}</div>
          </div>
        </div>
        {/* 悬浮融合区域 */}
        <div
          style={{
            marginTop: 'auto',
            marginBottom: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            background: 'rgba(255,255,255,0.95)',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            padding: '8px 0',
            minWidth: 40,
            userSelect: 'none',
            transition: 'background 0.2s',
          }}
          onClick={() => setCollapsed && setCollapsed(false)}
          title="展开侧边栏"
        >
          <Text style={{ fontSize: 10, color: '#bbb', writingMode: 'vertical-rl', marginBottom: 4 }}>
            © 投资组合管理工具
          </Text>
          <span style={{ fontSize: 22, color: '#222', marginTop: 2 }}>&lt;</span>
        </div>
      </div>
    );
  }
  
  // 展开状态下的渲染
  return (
    <div 
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#fafbfc',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        padding: '0 0 12px 0',
        minWidth: 0
      }}
      onClick={handleGlobalClick}
    >
      {/* 顶部分组：标题+刷新按钮 */}
      <div style={{ padding: '24px 20px 0 20px', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Title level={4} style={{ margin: 0, fontWeight: 700, letterSpacing: 1 }}>选择投资组合</Title>
          <Button
            type="text"
            icon={<ReloadOutlined spin={isLoadingPortfolios} />}
            onClick={handleRefresh}
            loading={isLoadingPortfolios}
            style={{ border: 'none', boxShadow: 'none' }}
            title="刷新投资组合列表"
          />
        </div>
        {/* 下拉选择框 */}
        <div style={{ marginTop: 20 }}>
          {isLoadingPortfolios && !portfolios.length ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Spin />
              <div style={{ marginTop: '8px', color: '#888' }}>加载投资组合中...</div>
            </div>
          ) : (
            <Select
              style={{ width: '100%', borderRadius: 6 }}
              placeholder="请选择一个投资组合"
              value={selectedPortfolioId}
              onChange={handleSelectChange}
              loading={isLoadingPortfolios}
              allowClear
              dropdownStyle={{ borderRadius: 8 }}
            >
              {portfolios.map((portfolio) => (
                <Option key={portfolio.id} value={portfolio.id}>
                  {portfolio.name}
                </Option>
              ))}
            </Select>
          )}
        </div>
        {/* +语录按钮 */}
        <Button
          type="primary"
          icon={<PlusOutlined />}
          style={{ 
            width: '100%', 
            marginTop: 16, 
            borderRadius: 6, 
            background: '#faad14', 
            borderColor: '#faad14',
            fontWeight: 700,
            fontSize: 18
          }}
          onClick={() => setIsQuoteModalVisible(true)}
        >语录</Button>
      </div>
      
      {/* 中间区域：励志语录 */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        position: 'relative',
        padding: '0 20px'
      }}>
        {/* 主语录竖排两列可拖拽缩放 */}
        {mainQuote && (
          <RndComponent
            size={{ width: rndState.width, height: rndState.height }}
            position={{ x: rndState.x, y: rndState.y }}
            bounds="parent"
            onDragStop={(_e: MouseEvent | TouchEvent, data: DraggableData) =>
              handleRndChange({ x: data.x, y: data.y })}
            onResizeStop={(_e: MouseEvent | TouchEvent, _dir: string, ref: HTMLElement, _delta: ResizableDelta, position: Position) => {
              handleRndChange(position, { width: ref.offsetWidth, height: ref.offsetHeight });
            }}
            style={{
              marginBottom: 16,
              zIndex: 2,
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              boxShadow: 'none',
              cursor: 'move',
            }}
            enableResizing={{
              top: true, right: true, bottom: true, left: true,
              topRight: true, bottomRight: true, bottomLeft: true, topLeft: true
            }}
          >
            <div 
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                gap: 12
              }}
              onClick={handleMainQuoteClick}
            >
              <div style={{
                writingMode: 'vertical-rl',
                fontSize: rndState.fontSize,
                fontWeight: 700,
                color: '#223',
                letterSpacing: 2,
                lineHeight: 1.2,
                textAlign: 'center',
                whiteSpace: 'pre-line',
                padding: '0 2px',
                userSelect: 'none'
              }}>{mainCol1}</div>
              <div style={{
                writingMode: 'vertical-rl',
                fontSize: rndState.fontSize,
                fontWeight: 700,
                color: '#223',
                letterSpacing: 2,
                lineHeight: 1.2,
                textAlign: 'center',
                whiteSpace: 'pre-line',
                padding: '0 2px',
                userSelect: 'none'
              }}>{mainCol2}</div>
            </div>
            {/* 字号缩放按钮和重置 - 只在主语录活动时显示 */}
            {isMainQuoteActive && (
              <div style={{ position: 'absolute', right: -40, top: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Button size="small" onClick={(e) => { e.stopPropagation(); handleFontSizeChange(2); }}>A+</Button>
                <Button size="small" onClick={(e) => { e.stopPropagation(); handleFontSizeChange(-2); }}>A-</Button>
                <Button size="small" onClick={(e) => { e.stopPropagation(); handleResetRnd(); }}>重置</Button>
              </div>
            )}
          </RndComponent>
        )}
        {/* 其它语录小字列表 - 使用Rnd实现拖拽和调整大小 */}
        {otherQuotes.length > 0 && (
          <RndComponent
            size={{ width: otherQuotesRndState.width, height: otherQuotesRndState.height }}
            position={{ x: otherQuotesRndState.x, y: otherQuotesRndState.y }}
            bounds="parent"
            onDragStop={(_e: MouseEvent | TouchEvent, data: DraggableData) =>
              handleOtherQuotesRndChange({ x: data.x, y: data.y })}
            onResizeStop={(_e: MouseEvent | TouchEvent, _dir: string, ref: HTMLElement, _delta: ResizableDelta, position: Position) => {
              handleOtherQuotesRndChange(position, { width: ref.offsetWidth, height: ref.offsetHeight });
            }}
            style={{
              zIndex: 2,
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              boxShadow: 'none',
              cursor: 'move',
            }}
            enableResizing={{
              top: true, right: true, bottom: true, left: true,
              topRight: true, bottomRight: true, bottomLeft: true, topLeft: true
            }}
          >
            <div 
              style={{ 
                width: '100%',
                height: '100%',
                position: 'relative',
                color: '#888', 
                fontSize: otherQuotesRndState.fontSize, 
                textAlign: 'center', 
                padding: '10px',
                overflow: 'auto'
              }}
              onClick={handleOtherQuotesClick}
            >
              {otherQuotes.map(q => (
                <div key={q.id} style={{ marginBottom: 2 }}>「{q.content}」</div>
              ))}
              {/* 副语录字号调整按钮 - 只在副语录活动时显示 */}
              {isOtherQuotesActive && (
                <div style={{ position: 'absolute', right: -40, top: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Button size="small" onClick={(e) => { e.stopPropagation(); handleOtherQuotesFontSizeChange(2); }}>A+</Button>
                  <Button size="small" onClick={(e) => { e.stopPropagation(); handleOtherQuotesFontSizeChange(-2); }}>A-</Button>
                  <Button size="small" onClick={(e) => { e.stopPropagation(); handleResetOtherQuotes(); }}>重置</Button>
                </div>
              )}
            </div>
          </RndComponent>
        )}
      </div>
      
      {renderQuoteModal()}

      {/* 悬浮融合区域 - 展开状态 */}
      <div
        style={{
          textAlign: 'center',
          padding: '8px 0',
          borderTop: '1px solid #f0f0f0',
          marginTop: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          userSelect: 'none',
          transition: 'background 0.2s',
        }}
        onClick={() => setCollapsed && setCollapsed(true)}
        title="收起侧边栏"
      >
        <Text style={{ fontSize: 12, color: '#bbb', marginRight: 8 }}>
          © 投资组合管理工具
        </Text>
        <span style={{ fontSize: 22, color: '#222' }}>&lt;</span>
      </div>

      {/* 创建投资组合 Modal */}
      <Modal
        title="创建新投资组合"
        open={isCreateModalVisible}
        onCancel={() => setIsCreateModalVisible(false)}
        footer={null}
        destroyOnClose
      >
        <CreatePortfolioForm onSuccess={handleCreateSuccess} />
      </Modal>
    </div>
  );
};

export default PortfolioList;