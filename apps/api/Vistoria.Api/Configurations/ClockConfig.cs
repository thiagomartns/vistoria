namespace Vistoria.Api.Configurations;

public static class ClockConfig
{
    // Todo horário vem daqui, nunca de DateTime.Now/UtcNow; os testes trocam por um relógio manual.
    public static IServiceCollection AddClock(this IServiceCollection services)
    {
        services.AddSingleton(TimeProvider.System);
        return services;
    }
}
