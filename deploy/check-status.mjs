/**
 * Check Northflank deployment status
 */

import { ApiClient, ApiClientInMemoryContextProvider } from '@northflank/js-client';

const NORTHFLANK_API_TOKEN = process.env.NORTHFLANK_API_TOKEN;

if (!NORTHFLANK_API_TOKEN) {
  console.log('Please set NORTHFLANK_API_TOKEN environment variable');
  process.exit(1);
}

async function checkStatus() {
  const contextProvider = new ApiClientInMemoryContextProvider();
  await contextProvider.addContext({
    name: 'deployment',
    token: NORTHFLANK_API_TOKEN,
  });

  const api = new ApiClient(contextProvider);
  try {
    console.log('🔍 Checking Northflank deployment status...\n');

    // Get all projects
    const projects = await api.list.projects();
    const projectList = projects.data?.projects || projects.projects || [];
    
    const polymarketProject = projectList.find(p => 
      p.name?.toLowerCase().includes('polymarket') || 
      p.name?.toLowerCase().includes('polymarketsim')
    );

    if (!polymarketProject) {
      console.log('❌ No Polymarket project found');
      return;
    }

    console.log(`📋 Project: ${polymarketProject.name || polymarketProject.id}`);
    console.log(`   Region: ${polymarketProject.region || 'N/A'}`);
    console.log(`   Status: ${polymarketProject.status || 'N/A'}\n`);

    const projectId = polymarketProject.id;

    // Check services
    try {
      const services = await api.list.services({ parameters: { projectId } });
      const serviceList = services.data?.services || services.services || [];

      console.log('🚀 Services:');
      for (const service of serviceList) {
        const status = service.status?.state || service.status || 'unknown';
        const emoji = status === 'running' ? '✅' : status === 'pending' ? '⏳' : '❌';
        
        console.log(`   ${emoji} ${service.name}: ${status}`);
        
        // Show more details about the service
        if (service.status?.replicas) {
          console.log(`      Replicas: ${service.status.replicas.desired}/${service.status.replicas.ready}`);
        }
        
        if (service.ports && service.ports.length > 0) {
          const port = service.ports[0];
          const url = `https://${service.name}-${projectId.slice(0, 8)}.northflank.app`;
          console.log(`      URL: ${url}`);
        }
      }
    } catch (e) {
      console.log('   ❌ Could not fetch services:', e.message);
    }

    console.log('');

    // Check addons (databases)
    try {
      const addons = await api.list.addons({ parameters: { projectId } });
      const addonList = addons.data?.addons || addons.addons || [];

      console.log('💾 Databases:');
      for (const addon of addonList) {
        const status = addon.status || 'unknown';
        const emoji = status === 'running' ? '✅' : status === 'pending' ? '⏳' : '❌';
        
        console.log(`   ${emoji} ${addon.name} (${addon.type}): ${status}`);
      }
    } catch (e) {
      console.log('   ❌ Could not fetch addons:', e.message);
    }

  } catch (error) {
    console.error('❌ Error checking status:', error.message);
  }
}

checkStatus();